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
import { auditCard, auditMarkdown, xrayCard, xrayMarkdown, arenaCard, arenaMarkdown } from "./present.mjs";
import { WIDGET_HTML, WIDGET_URI, WIDGET_URI_OPENAI } from "./widget.mjs";

const ICONS = [{ src: "https://www.scairos.com/getcited/brand/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }, { src: "https://www.scairos.com/getcited/brand/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] }];
const UI_META = { ui: { resourceUri: WIDGET_URI }, "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI_OPENAI, "openai/widgetAccessible": true };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export const TOOLS = [
  {
    name: "getcited_audit",
    title: "Audit a page for AI search",
    annotations: { title: "Audit a page for AI search", ...READ },
    _meta: { ...UI_META, "openai/toolInvocation/invoking": "Auditing the page like an AI crawler…", "openai/toolInvocation/invoked": "Audit ready" },
    description: "Audit a web page for AI-citation readiness (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews): AI crawler access in robots.txt and at the CDN, server rendering, structured data, quotability, trust. Returns a 0-100 score and prioritized fixes.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Page or domain to audit, e.g. example.com/pricing" }, pages: { type: "integer", minimum: 1, maximum: 50, default: 1 } }, required: ["url"] },
  },
  {
    name: "getcited_xray",
    title: "X-ray which sentences an AI would quote",
    annotations: { title: "Citation X-ray", ...READ },
    _meta: { ...UI_META, "openai/toolInvocation/invoking": "Scoring every sentence…", "openai/toolInvocation/invoked": "X-ray ready" },
    description: "Score every sentence of a page for how likely an AI answer engine is to quote it. Returns the share of quotable sentences, the best ones, and dead-weight sentences with reasons.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Page to X-ray" } }, required: ["url"] },
  },
  {
    name: "getcited_arena",
    title: "Who would an AI cite for this question?",
    annotations: { title: "Citation Arena", ...READ },
    _meta: { ...UI_META, "openai/toolInvocation/invoking": "Fetching the pages and ranking passages…", "openai/toolInvocation/invoked": "Arena ready" },
    description: "Simulate who an AI answer engine would cite for a question: chunks your page and competitor pages, fans out the query, ranks passages, and returns citation share per source, the winning passages and what your page is missing. Offline and deterministic unless a model is given.",
    inputSchema: { type: "object", properties: { question: { type: "string", description: "The question a buyer would ask an AI assistant" }, mine: { type: "string", description: "URL of your page" }, competitors: { type: "array", items: { type: "string" }, description: "Competitor page URLs (up to 6). If the user names none, pick the pages that rank for the question." }, k: { type: "integer", default: 5 }, model: { type: "string", description: "Optional provider:model for live answers, e.g. openai:gpt-4.1-mini" } }, required: ["question", "mine"] },
  },
  {
    name: "getcited_truth",
    title: "Check what a model believes about a brand",
    annotations: { title: "Truth check", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Ask a model what it believes about a brand (no browsing) and check each claim against known facts. Returns accuracy and the wrong claims.",
    inputSchema: { type: "object", properties: { brand: { type: "string" }, facts: { type: "array", items: { type: "string" } }, model: { type: "string" }, site: { type: "string" } }, required: ["brand", "facts", "model"] },
  },
];

/** Run a tool and return { data, text }: structured data for the report card and Markdown for the chat. */
export async function present(name, a, opts = {}) {
  const out = await call(name, a, opts);
  if (out?.error) return { data: { kind: "error", error: out.error }, text: `getcited couldn't run: ${out.error}` };
  if (name === "getcited_audit") { const c = auditCard(out); return { data: c, text: auditMarkdown(c) }; }
  if (name === "getcited_xray") { const c = xrayCard(out.url, out, out.fetched); return { data: c, text: xrayMarkdown(c) }; }
  if (name === "getcited_arena") { const c = arenaCard(out); return { data: c, text: arenaMarkdown(c) }; }
  return { data: out, text: JSON.stringify(out, null, 2) };
}

export const PROMPTS = [
  { name: "audit-my-site", title: "Audit my site for AI search", description: "Can ChatGPT, Perplexity, Claude and Google AI reach, read and quote your page?", arguments: [{ name: "url", description: "Your page or domain", required: true }],
    text: (a) => `Use getcited_audit on ${a.url}. Then tell me in plain words whether AI engines can reach, read and quote it, and the three fixes that matter most, with the evidence for each.` },
  { name: "who-gets-cited", title: "Who gets cited instead of me?", description: "Run the Citation Arena for a buyer's question against your competitors.", arguments: [{ name: "question", description: "A question your buyers ask an AI", required: true }, { name: "url", description: "Your page", required: true }, { name: "competitors", description: "Competitor URLs, comma-separated (optional)" }],
    text: (a) => `Use getcited_arena with the question "${a.question}", my page ${a.url}${a.competitors ? ` and these competitors: ${a.competitors}` : ", and pick 3 to 5 competitor pages that answer this question well"}. Tell me who wins the citation, why, and exactly what to change on my page to take it.` },
  { name: "fix-my-page", title: "Make my page quotable", description: "X-ray every sentence and rewrite the weak ones so an AI would quote them.", arguments: [{ name: "url", description: "Page to fix", required: true }],
    text: (a) => `Use getcited_xray on ${a.url}. Then rewrite the five weakest sentences so an answer engine would quote them, keeping every fact true. Show before and after.` },
];

export async function call(name, a, { hosted = false } = {}) {
  if (hosted && name === "getcited_truth") throw new Error("getcited_truth needs your own model key; run getcited locally (npx github:mohamedsaidyekhlef-png/getcited mcp)");
  if (hosted) { a = { ...a, pages: Math.min(5, a.pages || 1), competitors: (a.competitors || []).slice(0, 6), model: undefined }; }
  if (name === "getcited_audit") { const r = await audit(a.url, { pages: a.pages || 1 }); return r.error ? { error: r.error } : JSON.parse(toJson(r)); }
  if (name === "getcited_xray") {
    const r = await get(/^https?:/i.test(a.url) ? a.url : "https://" + a.url);
    if (!r.ok) return { error: r.error || `HTTP ${r.status}` };
    const x = xray(readHtml(r.body));
    return { url: r.url, fetched: { status: r.status, ms: r.ms }, summary: x.summary, best: x.best, worst: x.worst };
  }
  if (name === "getcited_arena") {
    const r = await arena(a.question, [{ url: a.mine, mine: true }, ...(a.competitors || []).map((url) => ({ url }))], { k: a.k || 5, llm: a.model ? resolveModel(a.model) : undefined });
    return r;
  }
  if (name === "getcited_truth") return truth({ brand: a.brand, facts: a.facts, site: a.site, llm: resolveModel(a.model) });
  throw new Error(`unknown tool ${name}`);
}

/** Handle one JSON-RPC message. Returns the response object, or null for notifications. */
export async function handleRpc(msg, { version = "1.2.0", hosted = false } = {}) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request" } };
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notifications (initialized, cancelled…)
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  try {
    if (method === "initialize") return ok({ protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "getcited", title: "getcited", version, description: "Unit tests for AI search: see whether ChatGPT, Perplexity, Claude and Google AI can reach, read and cite a page.", icons: ICONS, websiteUrl: "https://www.scairos.com/getcited" }, instructions: "getcited measures pages live, at call time. Use getcited_audit to check whether AI engines can reach and quote a page, getcited_xray to see which sentences an AI would quote, and getcited_arena to see who an AI answer engine would cite for a question and why. Each result already includes a readable report and an interactive card; summarize the verdict and the top fixes in your own words rather than repeating every number, and quote the evidence when the user asks if a result is real." });
    if (method === "ping") return ok({});
    if (method === "tools/list") return ok({ tools: hosted ? TOOLS.filter((t) => t.name !== "getcited_truth").map((t) => ({ ...t, inputSchema: { ...t.inputSchema, properties: Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== "model")) } })) : TOOLS });
    if (method === "tools/call") {
      try {
        const { data, text } = await present(params?.name, params?.arguments || {}, { hosted });
        return ok({ content: [{ type: "text", text }], structuredContent: data && typeof data === "object" && !Array.isArray(data) ? data : undefined, isError: data?.kind === "error" });
      } catch (e) {
        return ok({ content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    if (method === "resources/list") return ok({ resources: [
      { uri: WIDGET_URI, name: "getcited report card", mimeType: "text/html;profile=mcp-app", description: "Interactive report for audit, X-ray and arena results" },
      { uri: WIDGET_URI_OPENAI, name: "getcited report card (ChatGPT)", mimeType: "text/html+skybridge" },
    ] });
    if (method === "resources/templates/list") return ok({ resourceTemplates: [] });
    if (method === "resources/read") {
      const csp = { connectDomains: [], resourceDomains: [] };
      if (params?.uri === WIDGET_URI) return ok({ contents: [{ uri: WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: WIDGET_HTML, _meta: { ui: { csp, prefersBorder: true } } }] });
      if (params?.uri === WIDGET_URI_OPENAI) return ok({ contents: [{ uri: WIDGET_URI_OPENAI, mimeType: "text/html+skybridge", text: WIDGET_HTML, _meta: { "openai/widgetCSP": { connect_domains: [], resource_domains: [] }, "openai/widgetPrefersBorder": true, "openai/widgetDescription": "getcited report: score, evidence and fixes for AI search." } }] });
      return { jsonrpc: "2.0", id, error: { code: -32002, message: `resource not found: ${params?.uri}` } };
    }
    if (method === "prompts/list") return ok({ prompts: PROMPTS.map(({ text, ...p }) => p) });
    if (method === "prompts/get") {
      const p = PROMPTS.find((x) => x.name === params?.name);
      if (!p) return { jsonrpc: "2.0", id, error: { code: -32602, message: `unknown prompt ${params?.name}` } };
      return ok({ description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(params?.arguments || {}) } }] });
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e.message } };
  }
}

export function serveMcp({ input = process.stdin, output = process.stdout, version = "1.2.0" } = {}) {
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
