// Fetch the pages AI answers cite, split them into the passages engines retrieve, and
// index the passages for attribution. Polite by default: one request at a time per host,
// a delay between requests to the same host, a global concurrency cap, conditional
// re-fetch only when a page is older than `maxAgeDays`.

import { get } from "../fetch.mjs";
import { readHtml, wordCount } from "../html.mjs";
import { passages as split } from "../passages.mjs";
import { canonUrl, domainOf, sourceType, hash } from "./normalize.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function publishedOf(page) {
  const m = page.meta || {};
  const v = m["article:published_time"] || m["og:published_time"] || m.date || m["dc.date"] || m["article:modified_time"] || page.times?.[0] || null;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

/** Store a fetched page and its passages; returns the number of passages. */
export function storePage(index, canon, res) {
  const db = index.db;
  if (!res.ok) {
    db.prepare("insert or replace into pages(canon_url, final_url, status, fetched_at, error) values (?, ?, ?, datetime('now'), ?)").run(canon, res.url || null, res.status || 0, res.error || `HTTP ${res.status}`);
    return 0;
  }
  const page = readHtml(res.body);
  const parts = split(page, canon);
  index.tx(() => {
    db.prepare("delete from passages where canon_url = ?").run(canon);
    db.prepare("insert or replace into pages(canon_url, final_url, status, fetched_at, content_hash, title, published, words, error) values (?, ?, ?, datetime('now'), ?, ?, ?, ?, null)")
      .run(canon, res.url, res.status, hash(res.body), page.title || null, publishedOf(page), wordCount(page.mainText || page.text || ""));
    const ins = db.prepare("insert into passages(canon_url, ord, heading, text) values (?, ?, ?, ?)");
    parts.forEach((p, i) => ins.run(canon, i, p.heading || null, p.text));
  });
  return parts.length;
}

/** Gemini cites redirect URLs; once resolved, point those citations at the real page. */
function resolveCitation(index, redirect, finalUrl, brands) {
  const canon = canonUrl(finalUrl);
  if (!canon) return null;
  index.db.prepare("update citations set canon_url = ?, domain = ?, source_type = ? where canon_url = ?")
    .run(canon, domainOf(canon), sourceType(canon, { brands }), redirect);
  return canon;
}

export async function crawl(index, { concurrency = 8, perHostDelayMs = 1000, maxAgeDays = 7, limit = Infinity, fetchImpl = get, onProgress } = {}) {
  const brands = index.brands();
  const todo = index.all(`
    select c.canon_url u, count(*) n from citations c left join pages p on p.canon_url = c.canon_url
    where p.canon_url is null or p.fetched_at < datetime('now', ?)
    group by c.canon_url order by n desc`, `-${maxAgeDays} days`).slice(0, limit);
  const byHost = new Map();
  for (const t of todo) {
    let h = "x"; try { h = new URL(t.u).host; } catch {}
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(t.u);
  }
  const stats = { pages: 0, passages: 0, failed: 0, resolved: 0, ms: 0 };
  const t0 = performance.now();
  const hosts = [...byHost.entries()];
  let next = 0;
  async function worker() {
    while (next < hosts.length) {
      const [, urls] = hosts[next++];
      for (let i = 0; i < urls.length; i++) {
        let canon = urls[i];
        const res = await fetchImpl(canon);
        if (res.ok && /vertexaisearch|grounding-api-redirect/.test(canon)) {
          canon = resolveCitation(index, canon, res.url, brands) || canon;
          stats.resolved++;
          if (index.get("select 1 x from pages where canon_url = ? and fetched_at >= datetime('now', ?)", canon, `-${maxAgeDays} days`)) continue;
        }
        const n = storePage(index, canon, res);
        if (res.ok) { stats.pages++; stats.passages += n; } else stats.failed++;
        onProgress?.(stats);
        if (i < urls.length - 1) await sleep(perHostDelayMs);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length || 1) }, worker));
  stats.ms = Math.round(performance.now() - t0);
  return stats;
}
