// Citation Arena: put your page and your competitors' pages through the same
// retrieve-then-cite pipeline AI answer engines use, and see who gets cited.
//
// Offline mode (default, no API key, deterministic):
//   1. chunk every page into passages, heading kept as context
//   2. fan the question out into sub-queries, as AI search does
//   3. rank all passages per sub-query with BM25, adjusted for how quotable they are
//   4. fuse the rankings (reciprocal rank fusion) and take the top-k as the context
//   5. citation share = rank-weighted share of the context each source holds
// Live mode (--model): a real model answers from the top passages and cites them;
// passage order is shuffled across samples to cancel position bias.

import { readFile } from "node:fs/promises";
import { get } from "./fetch.mjs";
import { readHtml } from "./html.mjs";
import { passages } from "./passages.mjs";
import { bm25, hash, rng, termMap, terms } from "./text.mjs";
import { complete, cosine, embed } from "./llm.mjs";

const INTENTS = [
  { re: /\b(how much|cost|costs|price|prices|pricing|fee|fees|cheap|expensive|afford)\b/i, add: "price cost per month plan fee", why: "pricing" },
  { re: /\b(best|top|recommend|which|leading|alternative|alternatives)\b/i, add: "best comparison review alternatives rated", why: "comparison" },
  { re: /\b(vs\.?|versus|compare|comparison|difference|better than)\b/i, add: "vs difference compared comparison", why: "head to head" },
  { re: /^(what|what's|whats|define|definition|meaning)\b/i, add: "is a definition means refers", why: "definition" },
  { re: /^(how to|how do|how can|how should|steps|guide)\b/i, add: "steps how guide first then", why: "how-to" },
  { re: /^why\b/i, add: "because reason causes", why: "explanation" },
  { re: /\b(when|how long|how many years|year|date)\b/i, add: "year date since founded duration", why: "time" },
  { re: /\b(where|located|location|based)\b/i, add: "located based headquarters city country", why: "place" },
  { re: /\b(who|founder|founded|ceo|owner|author)\b/i, add: "founder founded ceo team author", why: "people" },
  { re: /\b(safe|legit|scam|trust|reliable|review|reviews)\b/i, add: "reviews rating trusted secure certified", why: "trust" },
];

/** Deterministic query fan-out: the sub-queries an AI search engine would run. */
export function fanout(question) {
  const key = terms(question);
  const subs = [{ q: question, why: "the question as asked" }];
  if (key.length > 1) subs.push({ q: key.join(" "), why: "key terms" });
  for (const it of INTENTS) if (it.re.test(question)) subs.push({ q: `${key.join(" ")} ${it.add}`, why: it.why });
  return subs.slice(0, 6);
}

export async function loadSource(src) {
  if (src.html !== undefined) return { ...src, ok: true, body: src.html };
  if (src.file) {
    try { return { ...src, ok: true, body: await readFile(src.file, "utf8"), url: src.url || src.file }; } catch (e) { return { ...src, ok: false, error: e.message }; }
  }
  const r = await get(src.url);
  return { ...src, ok: r.ok, status: r.status, error: r.error || (r.ok ? undefined : `HTTP ${r.status}`), body: r.body, url: r.url || src.url };
}

const host = (u) => { try { return new URL(u).host.replace(/^www\./, "") || u; } catch { return String(u).split(/[\\/]/).pop(); } };

/**
 * sources: [{ url | file | html, label?, mine? }]
 * opts: { k = 5, llm?: resolved model config, samples = 3, seed }
 */
export async function arena(question, sources, opts = {}) {
  if (!question?.trim()) throw new Error("arena needs a question");
  if (!sources.length) throw new Error("arena needs at least one page");
  const k = opts.k || 5;
  const loaded = opts.loaded || (await Promise.all(sources.map(loadSource)));
  const srcs = loaded.map((s, i) => {
    const page = s.ok ? readHtml(s.body) : null;
    const ps = page ? passages(page, s.url) : [];
    return { i, url: s.url, label: s.label || host(s.url), mine: Boolean(s.mine), ok: s.ok, error: s.error, title: page?.title || "", passages: ps };
  });
  const all = srcs.flatMap((s) => s.passages.map((p) => ({ ...p, source: s.i, key: `${s.i}:${p.id}` })));
  const docs = all.map((p) => [...terms(p.heading), ...terms(p.heading), ...terms(p.text)]);
  const index = bm25(docs);
  const subs = fanout(question);

  // Rank per sub-query, then fuse.
  const fused = new Map();
  const perQuery = subs.map((sq) => {
    const qt = terms(sq.q);
    const ranked = all
      .map((p, i) => ({ p, s: index.score(qt, i) * (0.8 + 0.4 * p.quality) * (p.lead ? 1.05 : 1) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.p.key.localeCompare(b.p.key));
    ranked.forEach((x, r) => fused.set(x.p.key, (fused.get(x.p.key) || 0) + 1 / (60 + r + 1)));
    return { ...sq, winner: ranked[0] ? srcs[ranked[0].p.source].label : null };
  });
  // Hybrid retrieval: add a dense (embedding) ranking per sub-query to the fusion.
  let retrieval = "bm25";
  if (opts.embed && all.length) {
    const vecs = await embed(opts.embed, [...subs.map((s) => s.q), ...all.map((p) => `${p.heading}\n${p.text}`.slice(0, 2000))]);
    const qv = vecs.slice(0, subs.length), pv = vecs.slice(subs.length);
    qv.forEach((v) => {
      all.map((p, i) => ({ p, s: cosine(v, pv[i]) }))
        .sort((a, b) => b.s - a.s || a.p.key.localeCompare(b.p.key))
        .forEach((x, r) => fused.set(x.p.key, (fused.get(x.p.key) || 0) + 1 / (60 + r + 1)));
    });
    retrieval = `hybrid (bm25 + ${opts.embed.label})`;
  }
  const ranking = all
    .filter((p) => fused.has(p.key))
    .map((p) => ({ ...p, rrf: fused.get(p.key) }))
    .sort((a, b) => b.rrf - a.rrf || a.key.localeCompare(b.key));
  const context = ranking.slice(0, k);
  const weights = context.map((_, r) => 1 / (r + 1));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;

  const standings = srcs.map((s) => {
    const mineRanks = ranking.map((p, r) => (p.source === s.i ? r : -1)).filter((r) => r >= 0);
    const share = context.reduce((a, p, r) => a + (p.source === s.i ? weights[r] : 0), 0) / wsum;
    return {
      label: s.label, url: s.url, mine: s.mine, ok: s.ok, error: s.error, passages: s.passages.length,
      bestRank: mineRanks.length ? mineRanks[0] + 1 : null,
      inContext: context.filter((p) => p.source === s.i).length,
      share: +share.toFixed(3),
      best: mineRanks.length ? pick(ranking[mineRanks[0]]) : null,
    };
  });

  const result = {
    tool: "getcited", mode: "offline", retrieval, question, k,
    fanout: perQuery,
    standings: [...standings].sort((a, b) => b.share - a.share || (a.bestRank ?? 1e9) - (b.bestRank ?? 1e9)),
    context: context.map((p, r) => ({ rank: r + 1, source: srcs[p.source].label, mine: srcs[p.source].mine, ...pick(p) })),
  };
  const me = standings.find((s) => s.mine);
  if (me) result.gap = gapAnalysis(question, subs, me, srcs, ranking, context);
  if (opts.llm) result.live = await liveRound(question, ranking.slice(0, Math.max(k, 8)), srcs, opts);
  return result;
}

const pick = (p) => ({ heading: p.heading, text: p.text.length > 600 ? p.text.slice(0, 597) + "…" : p.text, words: p.words, quality: p.quality });

function gapAnalysis(question, subs, me, srcs, ranking, context) {
  const mine = srcs.find((s) => s.mine);
  const winner = context.find((p) => !srcs[p.source].mine);
  const myText = new Set(mine.passages.flatMap((p) => [...terms(p.heading), ...terms(p.text)]));
  const myBest = ranking.find((p) => srcs[p.source].mine);
  const myBestTerms = new Set(myBest ? [...terms(myBest.heading), ...terms(myBest.text)] : []);
  const qTerms = [...new Set(terms(question))];
  const shown = new Map(termMap(question).map((x) => [x.t, x.raw]));
  const say = (ts) => ts.map((t) => `"${shown.get(t) || t}"`).join(", ");
  const winTerms = winner ? new Set([...terms(winner.heading), ...terms(winner.text)]) : new Set();
  const advice = [];
  if (!me.ok) advice.push(`Your page couldn't be loaded (${me.error}). An engine can't cite what it can't fetch.`);
  else if (!mine.passages.length) advice.push("No readable text in the HTML. If the content renders with JavaScript, AI crawlers see an empty page: server-render it.");
  const missingEverywhere = qTerms.filter((t) => !myText.has(t));
  const missingInBest = qTerms.filter((t) => myText.has(t) && !myBestTerms.has(t));
  const winnerHas = qTerms.filter((t) => winTerms.has(t) && !myBestTerms.has(t));
  if (missingEverywhere.length) advice.push(`The question's words ${say(missingEverywhere)} never appear on your page. Engines retrieve by matching the question first, so say it the way people ask it.`);
  if (missingInBest.length && myBest) advice.push(`Your best passage ("${myBest.heading || "untitled section"}") doesn't contain ${say(missingInBest)}; those words are elsewhere on the page. Put the answer and the question's words in the same short paragraph.`);
  if (winner && winnerHas.length && !missingEverywhere.length) advice.push(`The winning passage (${srcs[winner.source].label}) covers ${say(winnerHas)} in one place; yours doesn't.`);
  if (myBest && myBest.quality < 0.55) advice.push(`Your best passage reads as weak to quote (quality ${Math.round(myBest.quality * 100)}/100). Lead with one direct sentence that answers the question, with a specific number if you have a real one. Run getcited xray to see which sentences fail.`);
  if (myBest && myBest.words > 220) advice.push(`Your best passage is ${myBest.words} words. Engines quote tight chunks; give the answer its own short paragraph under a heading that matches the question.`);
  if (winner && /\d/.test(winner.text) && myBest && !/\d/.test(myBest.text)) advice.push("The winning passage has specific numbers and yours has none. Add real figures (prices, dates, measurements, counts) where you have them.");
  return {
    rank: me.bestRank, inContext: me.inContext, share: me.share,
    won: context[0] ? srcs[context[0].source].mine : false,
    winner: winner ? { source: srcs[winner.source].label, heading: winner.heading } : null,
    missingTerms: missingEverywhere.map((t) => shown.get(t) || t), advice,
  };
}

async function liveRound(question, pool, srcs, opts) {
  const samples = opts.samples || 3;
  const counts = new Map(srcs.map((s) => [s.i, 0]));
  let total = 0, myCitedIn = 0;
  const answers = [];
  const errors = [];
  for (let n = 0; n < samples; n++) {
    const r = rng(hash(question) + n * 7919 + (opts.seed || 0));
    const order = pool.map((p) => ({ p, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.p);
    const prompt = `Question: ${question}\n\nSources:\n${order.map((p, i) => `[${i + 1}] ${p.heading ? p.heading + ": " : ""}${p.text}`).join("\n\n")}\n\nAnswer the question in 3–6 sentences using only these sources. Put the source number in square brackets after every claim, like [2]. Cite only sources you actually used.`;
    let reply;
    try {
      reply = await complete(opts.llm, { system: "You are an AI search engine. You answer from the provided sources and cite them precisely.", prompt, temperature: 0.4 });
    } catch (e) { errors.push(e.message); continue; }
    const cited = new Set();
    for (const m of reply.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)) {
      for (const part of m[1].split(/\s*,\s*/)) {
        const [a, b] = part.split(/\s*[–-]\s*/).map(Number);
        for (let x = a; x <= (b || a); x++) if (order[x - 1]) cited.add(order[x - 1].source);
      }
    }
    for (const s of cited) counts.set(s, counts.get(s) + 1);
    total += cited.size;
    if ([...cited].some((s) => srcs[s].mine)) myCitedIn++;
    answers.push({ answer: reply.trim(), cited: [...cited].map((s) => srcs[s].label) });
  }
  if (!answers.length) return { model: opts.llm.label, error: errors[0] };
  return {
    model: opts.llm.label, samples: answers.length,
    share: srcs.map((s) => ({ label: s.label, mine: s.mine, citedIn: counts.get(s.i), share: total ? +(counts.get(s.i) / total).toFixed(3) : 0 })).sort((a, b) => b.share - a.share),
    mineCitedIn: myCitedIn,
    answer: answers[0].answer,
    answers,
    errors,
  };
}
