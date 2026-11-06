import { readFile } from "node:fs/promises";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 getcited/1.0";

/** Real user-agent strings the AI crawlers send, used to detect CDN-level blocking. */
export const BOT_UAS = {
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

/**
 * Fetch a URL the way a crawler would: no JavaScript, follow redirects, time out.
 * Never throws: network errors come back as { ok:false, error }.
 */
export async function get(url, { ua = BROWSER_UA, timeoutMs = 15000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const started = Date.now();
  if (url.startsWith("file://")) {
    try {
      const body = await readFile(new URL(url), "utf8");
      return { ok: true, status: 200, url, headers: new Headers({ "content-type": "text/html" }), body, ms: 0 };
    } catch (e) {
      return { ok: false, status: 0, url, headers: new Headers(), body: "", ms: 0, error: e.message };
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8", "accept-language": "en;q=0.9,*;q=0.5" },
    });
    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { ctrl.abort(); break; }
        chunks.push(value);
      }
      body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    }
    return { ok: res.ok, status: res.status, url: res.url || url, headers: res.headers, body, ms: Date.now() - started };
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || (e.name === "AbortError" ? "timed out" : e.message);
    return { ok: false, status: 0, url, headers: new Headers(), body: "", ms: Date.now() - started, error: cause };
  } finally {
    clearTimeout(timer);
  }
}

/** Heuristic: is this response a bot challenge or block page rather than content? */
export function looksBlocked(res) {
  if (!res.ok && [401, 403, 406, 429, 451, 503].includes(res.status)) return true;
  if (res.status === 0) return true;
  return /cf-chl-|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare|captcha-delivery|px-captcha|Access denied/i.test(res.body.slice(0, 20000));
}
