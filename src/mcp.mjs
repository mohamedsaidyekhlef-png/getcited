// `getcited mcp`: a Model Context Protocol server over stdio, so any agent
// (Claude, Cursor, Codex, VS Code…) can call the audit, X-ray and arena as tools.
// Newline-delimited JSON-RPC 2.0, no dependencies.

import { createInterface } from "node:readline";
import { audit } from "./audit.mjs";
import { arena } from "./arena.mjs";
import { get } from "./fetch.mjs";
import { readHtml } from "./html.mjs";
import { xray } from "./xray.mjs";
import { truth } from "./truth.mjs";
import { resolveModel } from "./llm.mjs";
import { toJson } from "./report.mjs";

export const TOOLS = [
  {
    name: "getcited_audit",
    description: "Audit a web page for AI-citation readiness (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews): AI crawler access in robots.txt and at the CDN, server rendering, structured data, quotability, trust. Returns a 0-100 score and prioritized fixes.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, pages: { type: "integer", minimum: 1, maximum: 50, default: 1 } }, required: ["url"] },
  },
  {
    name: "getcited_xray",
    description: "Score every sentence of a page for how likely an AI answer engine is to quote it. Returns the share of quotable sentences, the best ones, and dead-weight sentences with reasons.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "getcited_arena",
    description: "Simulate who an AI answer engine would cite for a question: chunks your page and competitor pages, fans out the query, ranks passages, and returns citation share per source, the winning passages and what your page is missing. Offline and deterministic unless a model is given.",
    inputSchema: { type: "object", properties: { question: { type: "string" }, mine: { type: "string", description: "URL of your page" }, competitors: { type: "array", items: { type: "string" } }, k: { type: "integer", default: 5 }, model: { type: "string", description: "Optional provider:model for live answers, e.g. openai:gpt-4.1-mini" } }, required: ["question", "mine"] },
  },
  {
    name: "getcited_truth",
    description: "Ask a model what it believes about a brand (no browsing) and check each claim against known facts. Returns accuracy and the wrong claims.",
    inputSchema: { type: "object", properties: { brand: { type: "string" }, facts: { type: "array", items: { type: "string" } }, model: { type: "string" }, site: { type: "string" } }, required: ["brand", "facts", "model"] },
  },
];

export async function call(name, a, { hosted = false } = {}) {
  if (hosted && name === "getcited_truth") throw new Error("getcited_truth needs your own model key; run getcited locally (npx github:mohamedsaidyekhlef-png/getcited mcp)");
  if (hosted) { a = { ...a, pages: Math.min(5, a.pages || 1), competitors: (a.competitors || []).slice(0, 6), model: undefined }; }
  if (name === "getcited_audit") { const r = await audit(a.url, { pages: a.pages || 1 }); return r.error ? { error: r.error } : JSON.parse(toJson(r)); }
  if (name === "getcited_xray") {
    const r = await get(/^https?:/i.test(a.url) ? a.url : "https://" + a.url);
    if (!r.ok) return { error: r.error || `HTTP ${r.status}` };
    const x = xray(readHtml(r.body));
    return { url: r.url, summary: x.summary, best: x.best, worst: x.worst };
  }
  if (name === "getcited_arena") {
    const r = await arena(a.question, [{ url: a.mine, mine: true }, ...(a.competitors || []).map((url) => ({ url }))], { k: a.k || 5, llm: a.model ? resolveModel(a.model) : undefined });
    return r;
  }
  if (name === "getcited_truth") return truth({ brand: a.brand, facts: a.facts, site: a.site, llm: resolveModel(a.model) });
  throw new Error(`unknown tool ${name}`);
}

/** Handle one JSON-RPC message. Returns the response object, or null for notifications. */
export async function handleRpc(msg, { version = "1.1.0", hosted = false } = {}) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request" } };
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notifications (initialized, cancelled…)
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  try {
    if (method === "initialize") return ok({ protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "getcited", title: "getcited: unit tests for AI search", version }, instructions: "Use getcited_audit to check whether AI engines can reach and quote a page, getcited_xray to see which sentences an AI would quote, and getcited_arena to see who an AI answer engine would cite for a question and why." });
    if (method === "ping") return ok({});
    if (method === "tools/list") return ok({ tools: hosted ? TOOLS.filter((t) => t.name !== "getcited_truth").map((t) => ({ ...t, inputSchema: { ...t.inputSchema, properties: Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== "model")) } })) : TOOLS });
    if (method === "tools/call") {
      try {
        const out = await call(params?.name, params?.arguments || {}, { hosted });
        return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out && typeof out === "object" && !Array.isArray(out) ? out : undefined, isError: Boolean(out?.error) });
      } catch (e) {
        return ok({ content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e.message } };
  }
}

export function serveMcp({ input = process.stdin, output = process.stdout, version = "1.1.0" } = {}) {
  const rl = createInterface({ input });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); }
    const res = await handleRpc(msg, { version });
    if (res) output.write(JSON.stringify(res) + "\n");
  });
  return rl;
}
