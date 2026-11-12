// `takeover`: one move from "who gets cited for this question?" to a passage that
// takes the citation, proven before you publish it, plus the off-site route.
//
//   1. Arena: who holds the passages an engine reads for the question today.
//   2. Draft: rebuild the answer from sentences already on your page (nothing is
//      written by a model, so nothing can be invented), in three shapes.
//   3. Prove: run the arena again with each draft placed on your page; keep the
//      draft that wins, with the before/after numbers.
//   4. Preview: the answer an engine would assemble from the new top passages,
//      with every sentence attributed to the page it came from.
//   5. Off-site: authority of every page in the fight (Open Authority, from
//      Common Crawl's web graph) and, for tracked domains, the sites that link to
//      the winner but not to you.

import { arena, loadSource, fanout } from "./arena.mjs";
import { readHtml } from "./html.mjs";
import { passages } from "./passages.mjs";
import { bm25, sentences, terms, words } from "./text.mjs";
import { scoreSentence } from "./xray.mjs";
import { inject, passageHtml } from "./simulate.mjs";
import { cleanDomain, lookup, targets } from "./authority.mjs";

const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return String(u); } };
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// A sentence an engine could lift on its own: ends like a sentence, isn't a menu run,
// doesn't open by pointing back at something it doesn't carry, isn't a quote fragment.
const DANGLE = /^(this|that|these|those|it|they|also|however|but|and|so|then|such|here|there|which|as a result|in addition|for example)\b/i;
export function standalone(s) {
  const t = s.trim();
  if (!/[.!?)”"]$/.test(t)) return false;
  if (/^["“'‘(]/.test(t) || DANGLE.test(t)) return false;
  const ws = t.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const caps = ws.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (ws.length >= 6 && caps / ws.length > 0.6) return false;
  return true;
}
/** Drop a run of navigation labels glued to the front of a real sentence; the rest stays verbatim. */
export function unmenu(s) {
  const w = s.trim().split(/\s+/);
  let i = 0;
  while (i < w.length && (/^[\p{Lu}\d]/u.test(w[i]) || /^(a|an|and|of|the|vs\.?|to|for|&)$/i.test(w[i]))) i++;
  return i >= 7 && i < w.length ? w.slice(i - 1).join(" ") : s.trim();
}
const DEFINE = /^(what|what's|whats|define|definition)\b/i;
const definitional = (q, s) => DEFINE.test(q) && /\b(is|are|refers to|means)\b/i.test(s);

/** Every usable sentence on the page, scored for this question and for quotability. */
export function candidateSentences(question, page, url) {
  const seen = new Set();
  const list = [];
  for (const p of passages(page, url)) {
    for (const raw of sentences(p.text)) {
      const s = unmenu(raw);
      const n = words(s);
      if (n < 6 || n > 45 || !standalone(s)) continue;
      const key = norm(s);
      if (seen.has(key)) continue;
      seen.add(key);
      const q = scoreSentence(s);
      if (q.verdict === "dead") continue;
      list.push({ pos: list.length, text: s.trim(), heading: p.heading, quality: q.score, number: /\d/.test(s), why: q.verdict === "quotable" ? q.plus : q.minus });
    }
  }
  if (!list.length) return [];
  const index = bm25(list.map((c) => [...terms(c.heading), ...terms(c.text), ...terms(c.text)]));
  const queries = fanout(question).map((f) => terms(f.q));
  const rel = list.map((_, i) => queries.reduce((a, q) => a + index.score(q, i), 0));
  const max = Math.max(...rel) || 1;
  return list
    .map((c, i) => ({ ...c, relevance: +(rel[i] / max).toFixed(3), score: +((rel[i] / max) * 0.65 + (c.quality / 100) * 0.35 + (definitional(question, c.text) ? 0.25 : 0)).toFixed(3) }))
    .filter((c) => c.relevance > 0)
    .sort((a, b) => b.score - a.score);
}

/** Three shapes of the same facts. Each sentence is quoted from the page as is. */
export function drafts(question, cands) {
  if (!cands.length) return [];
  const out = [];
  const direct = cands.slice(0, 3);
  out.push({ shape: "Direct answer", note: "The three sentences that answer the question best, as one short paragraph.", used: direct, text: direct.map((c) => c.text).join(" ") });
  const lead = cands[0];
  const facts = cands.slice(1).filter((c) => c.number).slice(0, 4);
  if (facts.length >= 2) out.push({ shape: "Answer, then figures", note: "The best answer sentence, then the figures from your page as a list.", used: [lead, ...facts], text: `${lead.text}\n\n${facts.map((c) => `- ${c.text}`).join("\n")}` });
  const pool = cands.slice(0, 8);
  const groups = new Map();
  for (const c of pool) { const h = (c.heading || "").split(" › ").pop() || "Details"; if (!groups.has(h)) groups.set(h, []); if (groups.get(h).length < 3) groups.get(h).push(c); }
  if (groups.size >= 2) {
    const secs = [...groups.entries()].slice(0, 3);
    const body = secs.map(([h, cs]) => [h, cs.filter((c) => c !== lead).sort((a, b) => a.pos - b.pos)]).filter(([, cs]) => cs.length);
    if (body.length) out.push({ shape: "Sectioned", note: "Your answer first, then short sub-sections under your own headings, the shape engines lift most often.", used: [lead, ...body.flatMap(([, cs]) => cs)], text: `${lead.text}\n\n${body.map(([h, cs]) => `### ${h}\n${cs.map((c) => c.text).join(" ")}`).join("\n\n")}` });
  }
  return out;
}

const standing = (a) => {
  const me = a.standings.find((s) => s.mine) || {};
  return { share: me.share || 0, rank: me.bestRank ?? null, leads: a.standings[0]?.mine === true, won: Boolean(a.gap?.won), leader: a.standings.find((s) => !s.mine)?.label || null };
};
const better = (x, y) => (x.won !== y.won ? x.won : x.leads !== y.leads ? x.leads : x.share !== y.share ? x.share > y.share : (x.rank ?? 1e9) < (y.rank ?? 1e9));

/** The answer an engine would assemble from the top passages, one sentence per source passage. */
export function projectAnswer(question, context, limit = 4) {
  const qt = new Set(terms(question));
  const picks = [];
  for (const p of context) {
    if (picks.length >= limit) break;
    const best = sentences(p.text).map(unmenu)
      .filter((s) => words(s) >= 6 && words(s) <= 50 && standalone(s))
      .map((s) => ({ s, k: terms(s).filter((t) => qt.has(t)).length + scoreSentence(s).score / 100 + (definitional(question, s) ? 3 : 0) }))
      .sort((a, b) => b.k - a.k)[0];
    if (!best || picks.some((u) => norm(u.s) === norm(best.s))) continue;
    picks.push({ ...best, p });
  }
  // An engine opens with the sentence that answers the question most directly.
  picks.sort((a, b) => b.k - a.k);
  const cites = [];
  const used = picks.map(({ s, p }) => {
    let n = cites.findIndex((c) => c.url === p.url) + 1;
    if (!n) { cites.push({ url: p.url, label: p.source, mine: p.mine }); n = cites.length; }
    return { text: s, cite: n, mine: p.mine, source: p.source };
  });
  return { sentences: used, sources: cites };
}

async function offsite(domains, me, winner) {
  try {
    const [rows, t] = await Promise.all([lookup(domains), targets()]);
    const by = Object.fromEntries(rows.map((r) => [r.query, r]));
    const W = winner && t[winner], M = me && t[me];
    let linkGap = null;
    if (W) {
      const complete = M && M.top.length >= M.referringDomains;
      const mine = new Set((M?.top || []).map((x) => x.domain));
      linkGap = {
        winner, complete: Boolean(complete || !M),
        domains: W.top.filter((x) => !mine.has(x.domain) && x.domain !== me).slice(0, 25),
        winnerTotal: W.referringDomains, yourTotal: M ? M.referringDomains : null,
      };
    }
    return { authority: domains.map((d) => by[d] || { domain: d, oa: null }), linkGap, tracked: Object.keys(t) };
  } catch (e) {
    return { authority: [], linkGap: null, error: e.message };
  }
}

/**
 * When your page has nothing to say, the winner's best sentences with every figure and
 * name blanked out: the facts you need to supply, in the shape that wins.
 */
export function blankTemplate(context, names = []) {
  const top = context.filter((p) => !p.mine).slice(0, 2);
  const out = [];
  for (const p of top) for (const s of sentences(p.text)) {
    if (out.length >= 4 || words(s) < 6 || words(s) > 45 || !standalone(s) || scoreSentence(s).verdict === "dead") continue;
    let t = s.replace(/[$€£]?\d[\d,.]*\d?(?:\s*(?:%|percent\b|days?\b|weeks?\b|months?\b|years?\b))?/gi, "[your figure]").replace(/(\[your figure\][\s,–-]*){2,}/g, "[your figure] ");
    if ((t.match(/\[your figure\]/g) || []).length > 4) continue;
    for (const n of names) if (n) t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[your brand]");
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * question: the buyer question. mine: your page URL. competitors: page URLs.
 * Returns before/after standings, the winning draft, every draft tried, a projected
 * answer, and the off-site picture.
 */
export async function takeover({ question, mine, competitors = [], k = 5 }) {
  if (!question?.trim()) throw new Error("takeover needs a question");
  if (!mine) throw new Error("takeover needs your page URL");
  if (!competitors.length) throw new Error("takeover needs at least one competing page: the pages that answer this question best today");
  const sources = [{ url: mine, mine: true }, ...competitors.map((url) => ({ url }))];
  const loaded = await Promise.all(sources.map(loadSource));
  if (!loaded[0].ok) return { error: `Your page couldn't be loaded: ${loaded[0].error}` };
  const before = await arena(question, sources, { k, loaded });
  const b = standing(before);
  const cands = candidateSentences(question, readHtml(loaded[0].body), loaded[0].url);
  const tried = [];
  for (const d of drafts(question, cands)) {
    const edited = { ...loaded[0], body: inject(loaded[0].body, passageHtml(question, d.text)) };
    const after = await arena(question, sources, { k, loaded: [edited, ...loaded.slice(1)] });
    tried.push({ ...d, after, result: standing(after) });
  }
  const best = tried.reduce((x, y) => (!x || better(y.result, x.result) ? y : x), null);
  const final = best?.after || before;
  const domains = [...new Set(loaded.map((s) => cleanDomain(host(s.url || ""))))];
  const winnerDomain = cleanDomain(host(before.standings.find((s) => !s.mine)?.url || ""));
  const off = await offsite(domains, domains[0], winnerDomain);
  return {
    kind: "takeover", question, mine: loaded[0].url, measuredAt: new Date().toISOString(),
    before: { ...b, context: before.context.slice(0, 5), answer: projectAnswer(question, before.context) },
    after: best ? { ...best.result, context: final.context.slice(0, 5), answer: projectAnswer(question, final.context) } : null,
    winner: best ? { shape: best.shape, note: best.note, heading: question, passage: best.text, html: passageHtml(question, best.text), sentences: best.used.map((c) => ({ text: c.text, from: c.heading, quality: c.quality })) } : null,
    tried: tried.map((t) => ({ shape: t.shape, ...t.result })),
    candidates: cands.length,
    standings: (best ? final : before).standings.map((s) => ({ label: s.label, url: s.url, mine: s.mine, before: before.standings.find((x) => x.url === s.url)?.share || 0, after: s.share, bestRank: s.bestRank })),
    advice: best ? (best.result.won ? [] : final.gap?.advice || []) : ["No sentence on your page answers this question, so there is nothing true to rearrange. Fill in the template below with your real figures, add it to the page and run takeover again."],
    template: best && best.result.won ? null : blankTemplate(before.context, before.standings.filter((s) => !s.mine).map((s) => s.label.split(".")[0])),
    offsite: off,
    faq: best ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: best.used.map((c) => c.text).join(" ") } }] } : null,
  };
}
