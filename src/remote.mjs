// Hosted getcited: the same engine behind a remote MCP endpoint and a small
// JSON API, for AI assistants (Claude, ChatGPT, Gemini…) that can't run Node
// locally. Hosted mode refuses private network addresses, caps work per call
// and never takes model keys.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { setUrlGuard } from "./fetch.mjs";
import { call, handleRpc, TOOLS } from "./mcp.mjs";

export { call, handleRpc, TOOLS };

function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

/** Throws unless the URL is a public http(s) address on a standard port. */
export async function publicUrlGuard(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`not a valid URL: ${raw}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http and https URLs are allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("only standard ports are allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("private addresses are not allowed");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("private addresses are not allowed");
}

export function enableHostedMode() { setUrlGuard(publicUrlGuard); }

// Best-effort rate limit per client (per server instance).
const buckets = new Map();
export function rateLimit(key, { limit = 30, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return { ok: b.n <= limit, remaining: Math.max(0, limit - b.n), reset: b.reset };
}
