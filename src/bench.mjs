// `getcited bench`: measure how well the arena predicts what a real answer
// engine cites. For each question you give the candidate pages; the engine's
// observed citations come either from your file (`observed:`) or live from an
// engine API that returns its sources (e.g. --observe perplexity:sonar).
// Metrics are computed over the candidate pages only, since that is what the arena ranks.

import { arena } from "./arena.mjs";
import { askEngine } from "./llm.mjs";
import { sourceOf } from "./spec.mjs";

const norm = (u) => {
  try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch { return String(u).toLowerCase().replace(/\/+$/, ""); }
};
const host = (u) => { try { return new URL(u).host.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Did the engine cite this candidate? Exact page match first, then same domain. */
function citedLevel(candidate, observed) {
  const n = norm(candidate), h = host(candidate);
  if (observed.some((o) => norm(o) === n)) return "page";
  if (h && observed.some((o) => host(o) === h)) return "domain";
  return null;
}

export async function bench(spec, { observe, embed, onQuestion = () => {} } = {}) {
  const rows = [];
  for (const q of spec.questions || []) {
    const pages = q.pages || [];
    if (!q.ask || pages.length < 2) continue;
    let observed = q.observed || null, answer = null, error = null;
    if (!observed && observe) {
      try { const r = await askEngine(observe, q.ask); observed = r.cited; answer = r.answer; } catch (e) { error = e.message; }
    }
    if (!observed) { rows.push({ ask: q.ask, error: error || "no observed citations (add observed: or --observe)" }); continue; }
    const r = await arena(q.ask, pages.map((p) => sourceOf(p, spec._dir || process.cwd(), false)), { k: spec.k || 5, embed });
    const loaded = r.standings.filter((s) => s.ok);
    const predicted = [...loaded].sort((a, b) => b.share - a.share || (a.bestRank ?? 1e9) - (b.bestRank ?? 1e9));
    const truth = loaded.map((s) => ({ url: s.url, label: s.label, level: citedLevel(s.url, observed) }));
    const citedSet = new Set(truth.filter((t) => t.level).map((t) => t.url));
    const n = Math.max(1, citedSet.size);
    const topN = predicted.slice(0, n).map((s) => s.url);
    const row = {
      ask: q.ask, observed, answer,
      candidates: loaded.length, citedCandidates: citedSet.size,
      predicted: predicted.map((s) => ({ label: s.label, share: s.share, rank: s.bestRank, cited: citedLevel(s.url, observed) })),
      top1Cited: citedSet.size ? citedSet.has(predicted[0]?.url) : null,
      precisionAtN: citedSet.size ? +(topN.filter((u) => citedSet.has(u)).length / n).toFixed(3) : null,
      // Random baseline for top-1: chance a random loaded candidate is cited.
      baselineTop1: loaded.length ? +(citedSet.size / loaded.length).toFixed(3) : null,
    };
    rows.push(row);
    onQuestion(row);
  }
  const scored = rows.filter((r) => r.top1Cited !== null && r.top1Cited !== undefined);
  const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null);
  return {
    tool: "getcited", kind: "bench", ranAt: new Date().toISOString(), engine: observe?.label || "from file", retrieval: embed ? `hybrid (${embed.label})` : "bm25",
    questions: rows.length, scored: scored.length,
    top1: mean(scored.map((r) => (r.top1Cited ? 1 : 0))),
    precisionAtN: mean(scored.map((r) => r.precisionAtN)),
    baselineTop1: mean(scored.map((r) => r.baselineTop1)),
    rows,
  };
}
