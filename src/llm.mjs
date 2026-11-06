// Bring-your-own-model client. One function, two wire formats:
//  - OpenAI-compatible chat completions: OpenAI, OpenRouter, Groq, Gemini, Ollama, LM Studio, vLLM…
//  - Anthropic Messages API
// Keys are read from the environment and never written to reports.

const PRESETS = {
  openai: { base: "https://api.openai.com/v1", key: "OPENAI_API_KEY", wire: "openai" },
  openrouter: { base: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", wire: "openai" },
  groq: { base: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", wire: "openai" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", wire: "openai" },
  mistral: { base: "https://api.mistral.ai/v1", key: "MISTRAL_API_KEY", wire: "openai" },
  deepseek: { base: "https://api.deepseek.com/v1", key: "DEEPSEEK_API_KEY", wire: "openai" },
  github: { base: "https://models.github.ai/inference", key: "GITHUB_TOKEN", wire: "openai" }, // free GitHub Models, e.g. github:openai/gpt-4.1-mini
  ollama: { base: "http://localhost:11434/v1", key: null, wire: "openai" },
  lmstudio: { base: "http://localhost:1234/v1", key: null, wire: "openai" },
  anthropic: { base: "https://api.anthropic.com/v1", key: "ANTHROPIC_API_KEY", wire: "anthropic" },
  perplexity: { base: "https://api.perplexity.ai", key: "PERPLEXITY_API_KEY", wire: "openai" }, // a real answer engine: returns the URLs it cited
};

/**
 * Resolve "provider:model" (e.g. "openai:gpt-4.1-mini", "anthropic:claude-haiku-5-5",
 * "ollama:llama3.1") into a callable config. `base` overrides the endpoint.
 */
export function resolveModel(spec, { base, env = process.env } = {}) {
  if (!spec) return null;
  const i = spec.indexOf(":");
  const provider = (i > 0 ? spec.slice(0, i) : "openai").toLowerCase();
  const model = i > 0 ? spec.slice(i + 1) : spec;
  const p = PRESETS[provider];
  if (!p) throw new Error(`unknown provider "${provider}". Use one of: ${Object.keys(PRESETS).join(", ")} (or any OpenAI-compatible endpoint with openai:<model> --base-url <url>)`);
  const envBase = env[`GETCITED_${provider.toUpperCase()}_BASE_URL`] || (provider === "openai" ? env.OPENAI_BASE_URL : provider === "anthropic" ? env.ANTHROPIC_BASE_URL : undefined);
  const key = p.key ? env[p.key] : "local";
  if (p.key && !key) throw new Error(`${p.key} is not set. Export it to use ${provider}:${model}.`);
  return { provider, model, wire: p.wire, base: (base || envBase || p.base).replace(/\/+$/, ""), key, label: `${provider}:${model}` };
}

export async function complete(cfg, { system, prompt, temperature = 0.3, maxTokens = 900, timeoutMs = 90000 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res, body;
    if (cfg.wire === "anthropic") {
      res = await fetch(`${cfg.base}/messages`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: prompt }] }),
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
      const text = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      if (!text.trim()) throw new Error(`empty reply (stop_reason: ${body.stop_reason ?? "none"})`);
      return text;
    }
    const headers = { "content-type": "application/json" };
    if (cfg.key && cfg.key !== "local") headers.authorization = `Bearer ${cfg.key}`;
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST", signal: ctrl.signal, headers,
      body: JSON.stringify({ model: cfg.model, temperature, max_tokens: maxTokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
    });
    const raw = await res.text();
    try { body = JSON.parse(raw); } catch { body = {}; }
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const msg = body.choices?.[0]?.message || {};
    const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((c) => c.text || "").join("") : "";
    if (!text.trim()) throw new Error(`empty reply (finish_reason: ${body.choices?.[0]?.finish_reason ?? "none"}${msg.refusal ? `, refusal: ${msg.refusal}` : ""}; response: ${raw.slice(0, 200)})`);
    return text;
  } catch (e) {
    const why = e.name === "AbortError" ? "timed out" : e?.cause?.code || e.message;
    throw new Error(`${cfg.label}: ${why}`);
  } finally {
    clearTimeout(t);
  }
}

/** Pull the first JSON value out of a model reply (handles ```json fences and chatter). */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) return null;
  for (let end = src.length; end > start; end--) {
    const ch = src[end - 1];
    if (ch !== "]" && ch !== "}") continue;
    try { return JSON.parse(src.slice(start, end)); } catch { /* keep shrinking */ }
  }
  return null;
}

/** Embeddings from any OpenAI-compatible /embeddings endpoint (OpenAI, Gemini, Mistral, Ollama, LM Studio…). */
export async function embed(cfg, inputs, { batch = 64, timeoutMs = 90000 } = {}) {
  if (cfg.wire !== "openai") throw new Error(`${cfg.label}: embeddings need an OpenAI-compatible provider`);
  const out = [];
  for (let i = 0; i < inputs.length; i += batch) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { "content-type": "application/json" };
      if (cfg.key && cfg.key !== "local") headers.authorization = `Bearer ${cfg.key}`;
      const res = await fetch(`${cfg.base}/embeddings`, { method: "POST", signal: ctrl.signal, headers, body: JSON.stringify({ model: cfg.model, input: inputs.slice(i, i + batch) }) });
      const raw = await res.text();
      let body = {};
      try { body = JSON.parse(raw); } catch { /* reported below */ }
      if (!res.ok || !Array.isArray(body.data)) throw new Error(body?.error?.message || `HTTP ${res.status}: ${raw.slice(0, 160)}`);
      for (const d of [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) out.push(d.embedding);
    } catch (e) {
      throw new Error(`${cfg.label} embeddings: ${e.name === "AbortError" ? "timed out" : e.message}`);
    } finally { clearTimeout(t); }
  }
  return out;
}

export function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

/** Ask an answer engine a question and return its answer plus the URLs it cited (Perplexity-style APIs). */
export async function askEngine(cfg, question, { timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: question }] }),
    });
    const raw = await res.text();
    let body = {};
    try { body = JSON.parse(raw); } catch { /* reported below */ }
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}: ${raw.slice(0, 160)}`);
    const urls = [...(body.citations || []), ...(body.search_results || []).map((r) => r.url)].filter((u) => typeof u === "string");
    return { answer: body.choices?.[0]?.message?.content || "", cited: [...new Set(urls)] };
  } catch (e) {
    throw new Error(`${cfg.label}: ${e.name === "AbortError" ? "timed out" : e.message}`);
  } finally { clearTimeout(t); }
}
