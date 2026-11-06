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

const TOOLS = [
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

async function call(name, a) {
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

export function serveMcp({ input = process.stdin, output = process.stdout, version = "1.0.0" } = {}) {
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const rl = createInterface({ input });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "parse error" } }); }
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications (initialized, cancelled…)
    try {
      if (method === "initialize") return send({ id, result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "getcited", version } } });
      if (method === "ping") return send({ id, result: {} });
      if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
      if (method === "tools/call") {
        try {
          const out = await call(params.name, params.arguments || {});
          return send({ id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: Boolean(out?.error) } });
        } catch (e) {
          return send({ id, result: { content: [{ type: "text", text: e.message }], isError: true } });
        }
      }
      send({ id, error: { code: -32601, message: `method not found: ${method}` } });
    } catch (e) {
      send({ id, error: { code: -32603, message: e.message } });
    }
  });
  return rl;
}
