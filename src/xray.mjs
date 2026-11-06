// Citation X-ray: scores every sentence on a page for how likely an AI answer
// engine is to lift it verbatim. Engines quote sentences that stand on their own,
// state one specific fact, and name their subject. They skip throat-clearing,
// marketing adjectives and sentences that only make sense in context.

import { sentences, words } from "./text.mjs";

const FLUFF = /\b(world[- ]class|best[- ]in[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|revolutionary|game[- ]chang\w*|seamless(ly)?|synerg\w+|leverag\w+|innovative|unparalleled|unrivall?ed|next[- ]gen(eration)?|empower\w*|unlock\w*|elevate\w*|supercharg\w+|robust|holistic|disrupt\w*|transform (your|the way)|one[- ]stop|second to none|passionate about|we pride ourselves|look no further|in today'?s (fast[- ]paced|digital) world)\b/gi;
const HEDGE = /\b(might|perhaps|possibly|arguably|somewhat|we believe|we think|in our opinion|it seems|kind of|sort of)\b/i;
const CTA = /\b(click here|learn more|read more|sign up|subscribe|get started|book a (demo|call)|contact us|call us|download now|try (it )?(for )?free|buy now|add to cart|follow us)\b/i;
const DANGLING = /^(it|this|that|these|those|they|he|she|its|their|here|there|such|also|however|but|and|so|which|as (mentioned|noted|discussed))\b/i;
const CONTEXT = /\b(see|shown|listed|described|mentioned|noted|outlined) (above|below)\b|\b(above|below)\s*[:.]?\s*$|\bas (mentioned|shown|discussed)\b|\bthe following\b|\bsee (the )?(table|chart|image|figure)\b|\bin this (article|post|guide)\b/i;
const FACT = /\b(is|are|was|were) (a|an|the|one of|about|around|over|under|\d)|\b(costs?|charges?|means|refers to|consists of|includes|contains|requires|takes|lasts|measures|weighs|equals|ranges from|starts at|was founded|is based|is located|launched|released|lets you|allows|enables|works by|happens when|means that)\b/i;
const SOURCE = /\b(according to|found that|reported|reports that|study|survey|research(ers)?|data from|analysis of|published|census|per the)\b/i;
const NUMBER = /(\d[\d.,]*\s?(%|percent|x|×|ms|s|kb|mb|gb|km|kg|m|cm|mm|h|hours?|days?|weeks?|months?|years?|users?|customers?|people)?\b)|[$€£¥₹]\s?\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|half|double)\b/i;

/** Score one sentence: 0–100 plus the reasons, positive and negative. */
export function scoreSentence(s) {
  const n = words(s);
  const plus = [], minus = [];
  let score = 40;
  if (n < 5) return { score: 5, plus, minus: ["fragment, too short to quote"], verdict: "dead" };
  if (CTA.test(s)) return { score: 5, plus, minus: ["call to action, not information"], verdict: "dead" };
  if (n >= 8 && n <= 35) { score += 12; plus.push("liftable length"); }
  else if (n > 50) { score -= 18; minus.push(`${n} words, too long to lift; split it`); }
  else if (n > 35) { score -= 6; minus.push(`${n} words, a little long`); }
  if (NUMBER.test(s)) { score += 18; plus.push("specific number"); }
  if (FACT.test(s)) { score += 14; plus.push("states a fact directly"); }
  if (SOURCE.test(s)) { score += 10; plus.push("attributes a source"); }
  if (/["“][^"”]{12,}["”]/.test(s)) { score += 6; plus.push("contains a quotation"); }
  if (/\s\p{Lu}[\p{L}\p{N}]+/u.test(s.slice(1))) { score += 6; plus.push("names a subject"); }
  if (!DANGLING.test(s) && /^(a|an|the)\s+[\p{L}\p{N}]|^\p{Lu}[\p{L}\p{N}]+\s/iu.test(s) && !/^(click|get|ask|sell|call|try|read|see|buy|make)\b/i.test(s)) { score += 6; plus.push("opens with its subject"); }
  if (DANGLING.test(s)) { score -= 22; minus.push(`starts with "${s.split(/\s/)[0]}", so it doesn't stand alone`); }
  if (CONTEXT.test(s)) { score -= 14; minus.push("points at context the engine won't carry over"); }
  const fluff = s.match(FLUFF) || [];
  if (fluff.length) { score -= Math.min(30, 15 * fluff.length); minus.push(`marketing fluff: ${[...new Set(fluff.map((f) => f.toLowerCase()))].join(", ")}`); }
  if (HEDGE.test(s)) { score -= 10; minus.push("hedged, engines prefer definite statements"); }
  if (/\?\s*$/.test(s)) { score -= 14; minus.push("a question, not an answer"); }
  if (/!\s*$/.test(s)) { score -= 6; minus.push("exclamation reads as promotion"); }
  score = Math.max(0, Math.min(100, score));
  return { score, plus, minus, verdict: score >= 65 ? "quotable" : score >= 40 ? "weak" : "dead" };
}

/** X-ray a parsed page (from readHtml). */
export function xray(page) {
  const useMain = page.hasMain && page.blocks.some((b) => b.inMain);
  const pool = page.blocks.filter((b) => (useMain ? b.inMain : true) && !["summary", "th", "td"].includes(b.tag));
  const out = [];
  const layout = []; // headings and paragraphs in order, for the heatmap
  pool.forEach((b, bi) => {
    const h = /^h([1-6])$/.exec(b.tag);
    if (h) { layout.push({ h: b.text, level: Number(h[1]) }); return; }
    const idx = [];
    for (const s of sentences(b.text)) { idx.push(out.length); out.push({ block: bi, tag: b.tag, text: s, words: words(s), ...scoreSentence(s) }); }
    if (idx.length) layout.push({ tag: b.tag, s: idx });
  });
  const total = out.length || 1;
  const q = out.filter((s) => s.verdict === "quotable");
  const dead = out.filter((s) => s.verdict === "dead");
  const allWords = out.reduce((a, s) => a + s.words, 0) || 1;
  const avg = Math.round(out.reduce((a, s) => a + s.score, 0) / total);
  return {
    sentences: out,
    layout,
    summary: {
      sentences: out.length,
      quotable: q.length,
      weak: out.filter((s) => s.verdict === "weak").length,
      dead: dead.length,
      quotableShare: Math.round((q.length / total) * 100),
      deadWordShare: Math.round((dead.reduce((a, s) => a + s.words, 0) / allWords) * 100),
      perHundredWords: +((q.length / allWords) * 100).toFixed(2),
      average: out.length ? avg : 0,
      firstQuotable: out.findIndex((s) => s.verdict === "quotable"),
    },
    best: [...out].sort((a, b) => b.score - a.score || a.text.length - b.text.length).slice(0, 5),
    worst: [...out].filter((s) => s.minus.length).sort((a, b) => a.score - b.score).slice(0, 5),
  };
}
