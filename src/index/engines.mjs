// Engine collectors. Each one asks a real answer engine a prompt the way a user would,
// and returns one shape:
//   { engine, model, answer, citations: [{ url, title, spanStart, spanEnd, support, domainHint, resolve }],
//     costUsd, latencyMs, raw }
// `support` is the engine's own statement of which text a citation backs (ground truth
// for attribution) when the API provides it.

const PRICES = {
  // USD; per 1M input/output tokens, plus per search. Override with opts.prices.
  openai: { in: 1.25, out: 10, search: 0.01 },
  anthropic: { in: 1, out: 5, search: 0.01 },
  gemini: { in: 0.3, out: 2.5, search: 0.035 },
  perplexity: { in: 1, out: 1, search: 0.005 },
};
const DEFAULT_MODEL = {
  openai: process.env.OPENAI_SEARCH_MODEL || "gpt-6-astra",
  anthropic: process.env.ANTHROPIC_SEARCH_MODEL || "claude-haiku-5-5",
  gemini: process.env.GEMINI_SEARCH_MODEL || "gemini-flash-latest",
  perplexity: process.env.PERPLEXITY_EFFORT || "fast",
};
const KEY = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", perplexity: "PERPLEXITY_API_KEY" };

export class EngineError extends Error {
  constructor(message, { status, retryable, retryAfterMs } = {}) { super(message); this.status = status; this.retryable = Boolean(retryable); this.retryAfterMs = retryAfterMs; }
}

function market(m = "us-en") {
  const [country = "us", lang = "en"] = String(m).toLowerCase().split("-");
  return { country: country.toUpperCase(), lang };
}

async function post(url, headers, body, { timeoutMs = 90000, fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    throw new EngineError(`network: ${e.name === "AbortError" ? "timeout" : e.message}`, { retryable: true });
  } finally { clearTimeout(t); }
  const text = await res.text();
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    throw new EngineError(`HTTP ${res.status}: ${text.slice(0, 300)}`, { status: res.status, retryable: res.status === 429 || res.status >= 500, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined });
  }
  try { return JSON.parse(text); } catch { throw new EngineError("invalid JSON from engine", { retryable: true }); }
}

/** Sentence of `text` that contains offset `i` (for engines that give only a position). */
function sentenceAt(text, i) {
  let a = i, b = i;
  while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
  while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
  return text.slice(a, Math.min(text.length, b + 1)).replace(/\[\d+\]/g, "").trim();
}

const tokensCost = (p, inT = 0, outT = 0, searches = 0) => (inT * p.in + outT * p.out) / 1e6 + searches * p.search;

// ---------------------------------------------------------------- Perplexity
// Agent API (Sonar chat completions were retired in Sept 2026): POST /v1/agent { effort, input }.
// Output: a `message` item (output_text) and a `search_results` item; the answer cites
// results with inline [n] markers matching result ids.
export async function perplexity(prompt, { apiKey = process.env.PERPLEXITY_API_KEY, model = DEFAULT_MODEL.perplexity, market: m, prices = PRICES.perplexity, fetchImpl } = {}) {
  if (!apiKey) throw new EngineError("PERPLEXITY_API_KEY is not set");
  const t0 = Date.now();
  const r = await post("https://api.perplexity.ai/v1/agent", { authorization: `Bearer ${apiKey}` }, { effort: model, input: prompt }, { fetchImpl });
  const items = r.output || [];
  const answer = items.filter((x) => x.type === "message").flatMap((x) => x.content || []).filter((c) => c.type === "output_text").map((c) => c.text).join("\n") || r.output_text || "";
  const results = items.filter((x) => x.type === "search_results").flatMap((x) => x.results || []);
  const byId = new Map(results.map((s, i) => [Number(s.id ?? i + 1), s]));
  const citations = [];
  for (const mk of answer.matchAll(/\[(\d+)\]/g)) {
    const s = byId.get(Number(mk[1]));
    if (s) citations.push({ url: s.url, title: s.title, spanStart: mk.index, spanEnd: mk.index + mk[0].length, support: sentenceAt(answer, mk.index), published: s.date || s.last_updated || null });
  }
  if (!citations.length) results.forEach((s) => citations.push({ url: s.url, title: s.title, published: s.date || null }));
  const u = r.usage || {};
  const cost = u.cost?.total_cost ?? tokensCost(prices, u.input_tokens ?? u.prompt_tokens, u.output_tokens ?? u.completion_tokens, 1);
  return { engine: "perplexity", model: r.model || `agent:${model}`, answer, citations, costUsd: cost, latencyMs: Date.now() - t0, raw: r };
}

// ---------------------------------------------------------------- OpenAI
// Responses API with the hosted `web_search` tool; citations are `url_citation`
// annotations with character spans into the output text.
export async function openai(prompt, { apiKey = process.env.OPENAI_API_KEY, model = DEFAULT_MODEL.openai, market: m, prices = PRICES.openai, fetchImpl } = {}) {
  if (!apiKey) throw new EngineError("OPENAI_API_KEY is not set");
  const t0 = Date.now();
  const { country } = market(m);
  const r = await post("https://api.openai.com/v1/responses", { authorization: `Bearer ${apiKey}` }, {
    model, input: prompt, tool_choice: "auto",
    tools: [{ type: "web_search", user_location: { type: "approximate", country } }],
    include: ["web_search_call.action.sources"],
  }, { fetchImpl });
  let answer = "";
  const citations = [];
  let searches = 0;
  for (const item of r.output || []) {
    if (item.type === "web_search_call") searches++;
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type !== "output_text") continue;
      const base = answer.length ? answer.length + 1 : 0;
      answer += (answer ? "\n" : "") + c.text;
      for (const a of c.annotations || []) {
        if (a.type !== "url_citation") continue;
        const s = base + (a.start_index ?? 0), e = base + (a.end_index ?? 0);
        citations.push({ url: a.url, title: a.title, spanStart: s, spanEnd: e, support: sentenceAt(answer, Math.max(base, s - 1)) });
      }
    }
  }
  const u = r.usage || {};
  return { engine: "openai", model: r.model || model, answer, citations, costUsd: tokensCost(prices, u.input_tokens, u.output_tokens, searches), latencyMs: Date.now() - t0, raw: r };
}

// ---------------------------------------------------------------- Gemini
// generateContent with the `google_search` tool. groundingChunks hold redirect URIs
// (resolved later by the crawler) with the source domain as title; groundingSupports
// map answer segments to chunks, which is ground truth for attribution.
export async function gemini(prompt, { apiKey = process.env.GEMINI_API_KEY, model = DEFAULT_MODEL.gemini, market: m, prices = PRICES.gemini, fetchImpl } = {}) {
  if (!apiKey) throw new EngineError("GEMINI_API_KEY is not set");
  const t0 = Date.now();
  const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": apiKey }, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  }, { fetchImpl });
  const cand = r.candidates?.[0] || {};
  const answer = (cand.content?.parts || []).map((p) => p.text || "").join("");
  const g = cand.groundingMetadata || {};
  const chunks = (g.groundingChunks || []).map((c) => c.web || c.retrievedContext || {});
  const support = chunks.map(() => []);
  const spans = chunks.map(() => null);
  for (const s of g.groundingSupports || []) {
    const seg = s.segment || {};
    // Indexes are UTF-8 byte offsets; locate the segment by its text instead.
    const at = seg.text ? answer.indexOf(seg.text) : -1;
    for (const i of s.groundingChunkIndices || []) {
      if (!support[i]) continue;
      if (seg.text) support[i].push(seg.text);
      if (at >= 0 && !spans[i]) spans[i] = [at, at + seg.text.length];
    }
  }
  const citations = chunks.map((c, i) => ({
    url: c.uri, title: c.title, domainHint: /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.title || "") ? c.title.toLowerCase() : null,
    resolve: /vertexaisearch|grounding-api-redirect/.test(c.uri || ""), spanStart: spans[i]?.[0], spanEnd: spans[i]?.[1], support: support[i].join(" ") || null,
  })).filter((c) => c.url);
  const u = r.usageMetadata || {};
  return { engine: "gemini", model: r.modelVersion || model, answer, citations, costUsd: tokensCost(prices, u.promptTokenCount, u.candidatesTokenCount, (g.webSearchQueries || []).length ? 1 : 0), latencyMs: Date.now() - t0, raw: r };
}

// ---------------------------------------------------------------- Anthropic
// Messages API with `web_search_20250305`. Text blocks carry `web_search_result_location`
// citations with `cited_text`, the exact source text (up to 150 characters).
export async function anthropic(prompt, { apiKey = process.env.ANTHROPIC_API_KEY, model = DEFAULT_MODEL.anthropic, market: m, prices = PRICES.anthropic, fetchImpl } = {}) {
  if (!apiKey) throw new EngineError("ANTHROPIC_API_KEY is not set");
  const t0 = Date.now();
  const { country } = market(m);
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  const body = { model, max_tokens: 2048, messages: [{ role: "user", content: prompt }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5, user_location: { type: "approximate", country } }] };
  let r, blocks = [], inT = 0, outT = 0, searches = 0;
  for (let turn = 0; turn < 4; turn++) {
    r = await post("https://api.anthropic.com/v1/messages", headers, body, { fetchImpl });
    blocks = blocks.concat(r.content || []);
    inT += r.usage?.input_tokens || 0; outT += r.usage?.output_tokens || 0; searches += r.usage?.server_tool_use?.web_search_requests || 0;
    if (r.stop_reason !== "pause_turn") break;
    body.messages = [...body.messages, { role: "assistant", content: r.content }];
  }
  let answer = "";
  const citations = [];
  for (const b of blocks) {
    if (b.type !== "text") continue;
    const s = answer.length;
    answer += b.text;
    for (const c of b.citations || []) if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title, spanStart: s, spanEnd: answer.length, support: c.cited_text || null, supportIsSource: true });
  }
  return { engine: "anthropic", model: r?.model || model, answer, citations, costUsd: tokensCost(prices, inT, outT, searches), latencyMs: Date.now() - t0, raw: { stop_reason: r?.stop_reason, usage: r?.usage } };
}

// ---------------------------------------------------------------- Mock
// Deterministic engine over a fixture corpus: retrieves passages, writes an answer
// from them and cites them, with labels. For tests, benchmarks and attribution evals.
export function mockEngine(corpus, { latencyMs = 0, seed = 1, citeTop = 3 } = {}) {
  const words = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g) || [];
  return async function mock(prompt, { sample = 0 } = {}) {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    const q = new Set(words(prompt));
    let x = (seed * 2654435761 + sample * 40503 + [...prompt].reduce((a, c) => a + c.charCodeAt(0), 0)) >>> 0;
    const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const scored = corpus.map((p) => ({ p, s: words(p.text).filter((w) => q.has(w)).length + rnd() * 1.5 })).sort((a, b) => b.s - a.s).slice(0, citeTop);
    let answer = "";
    const citations = [];
    scored.forEach(({ p }, i) => {
      const sent = (p.text.match(/[^.!?]+[.!?]/) || [p.text])[0].trim();
      const s = answer.length;
      answer += (answer ? " " : "") + sent;
      citations.push({ url: p.url, title: p.title, spanStart: s ? s + 1 : 0, spanEnd: answer.length, support: sent, label: p.url });
      if (p.brand) answer += ` ${p.brand} is one option.`;
    });
    return { engine: "mock", model: "mock-1", answer, citations, costUsd: 0.001, latencyMs, raw: null };
  };
}

export const ENGINES = { perplexity, openai, gemini, anthropic };
export const ENGINE_KEYS = KEY;
export const available = (env = process.env) => Object.keys(ENGINES).filter((e) => env[KEY[e]]);
