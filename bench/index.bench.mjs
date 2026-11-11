// Benchmark the AI Answer Index pipeline at scale on a synthetic vertical.
//   node bench/index.bench.mjs [--pages 3000] [--prompts 1500] [--samples 2] [--noise 0.3] [--db file]
// Answers are built from corpus passages and then paraphrased (synonyms, dropped words,
// reordered clauses) so attribution is measured on text that isn't copied verbatim.
// Real-engine accuracy is reported separately by `getcited index report` from labels.

import { rmSync, statSync } from "node:fs";
import { openIndex } from "../src/index/store.mjs";
import { collect } from "../src/index/collect.mjs";
import { storePage } from "../src/index/crawl.mjs";
import { attribute, evaluate } from "../src/index/attribute.mjs";
import { shareOfVoice, citedDomains, difficulty, opportunities } from "../src/index/metrics.mjs";
import { canonUrl } from "../src/index/normalize.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PAGES = +arg("pages", 3000), PROMPTS = +arg("prompts", 1500), SAMPLES = +arg("samples", 2), NOISE = +arg("noise", 0.3);
const DB = arg("db", "/tmp/getcited-bench.db");
let seed = 42;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; // mulberry32
const pick = (a) => a[Math.floor(rnd() * a.length)];

const TOPICS = ["discount rate", "court approval", "excise tax", "lump sum", "annuity payments", "lottery winnings", "transfer law", "payment schedule", "present value", "life contingent payments", "partial sale", "independent advice", "funding time", "buyer reviews", "fees", "early payout", "insurance company", "qualified assignment", "state statute", "hearing date"];
const STATES = ["California", "Florida", "Texas", "New York", "Ohio", "Georgia", "Illinois", "Arizona"];
const VERBS = ["requires", "usually involves", "often depends on", "is set by", "can change", "typically includes"];
const SYN = { usually: "typically", often: "frequently", requires: "needs", payments: "installments", buyer: "purchaser", buyers: "purchasers", approval: "sign-off", sale: "transaction", typically: "generally", includes: "covers", fees: "charges", depends: "hinges" };
const BRANDS = Array.from({ length: 120 }, (_, i) => ({ name: `Brand${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)} Capital`, domain: `brand${i}.com` }));

function sentence(topic) {
  const n = Math.floor(rnd() * 90) + 5;
  return `In ${pick(STATES)}, the ${topic} ${pick(VERBS)} ${pick(["a judge", "the buyer", "the insurer", "state law", "the court"])} and ${n}% of sellers see ${pick(["a delay", "a lower offer", "a higher fee", "a faster payout"])} of ${Math.floor(rnd() * 120) + 10} days.`;
}

console.log(`Building corpus: ${PAGES} pages…`);
const corpus = [];
for (let i = 0; i < PAGES; i++) {
  const brand = i % 5 === 0 ? BRANDS[i % BRANDS.length] : null;
  const host = brand ? brand.domain : pick(["reddit.com", "youtube.com", "irs.gov", "forbes.com", "wikipedia.org", `site${i % 400}.com`]);
  const url = `https://www.${host}/page-${i}`;
  const paras = Array.from({ length: 6 }, () => { const t = pick(TOPICS); return { heading: t, text: [sentence(t), sentence(t)].join(" ") + (brand ? ` ${brand.name} handles this.` : "") }; });
  corpus.push({ url, brand, paras });
}
const byTopic = new Map(TOPICS.map((t) => [t, []]));
for (const p of corpus) for (const [j, para] of p.paras.entries()) byTopic.get(para.heading).push({ p, j });

function paraphrase(s) {
  // One sentence in, one sentence out: reorder its two clauses, swap synonyms, drop filler words.
  const body = s.replace(/\.\s*$/, "");
  let parts = body.split(/ and (?=\d)/);
  if (parts.length === 2 && rnd() < NOISE) parts = [parts[1], parts[0].replace(/^In ([A-Z][a-z]+(?: [A-Z][a-z]+)?), /, "in $1, ")];
  const out = parts.join(" and ").split(" ").filter((w) => !(rnd() < NOISE * 0.4 && /^(the|a|of|see)$/i.test(w))).map((w) => (rnd() < NOISE && SYN[w.toLowerCase()] ? SYN[w.toLowerCase()] : w)).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1) + ".";
}

// Engine: picks passages on the prompt's topic, paraphrases one sentence from each, cites it with a span.
const engine = async (prompt, { sample = 0 } = {}) => {
  const topic = TOPICS.find((t) => prompt.includes(t)) || pick(TOPICS);
  const pool = byTopic.get(topic);
  let answer = "";
  const citations = [];
  for (let k = 0; k < 4; k++) {
    const { p, j } = pool[Math.floor(rnd() * pool.length)];
    const src = p.paras[j].text.split(/(?<=\.)\s/)[Math.floor(rnd() * 2)];
    const out = paraphrase(src);
    const s = answer ? answer.length + 1 : 0;
    answer += (answer ? " " : "") + out;
    citations.push({ url: p.url, title: p.paras[j].heading, spanStart: s, spanEnd: answer.length });
    if (p.brand && rnd() < 0.5) answer += ` ${p.brand.name} is often recommended.`;
  }
  return { engine: "bench", model: "bench-1", answer, citations, costUsd: 0, latencyMs: 0 };
};

const ms = (t) => +(performance.now() - t).toFixed(1);
function timeQuery(fn, n = 7) {
  const xs = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(); xs.push(performance.now() - t); }
  xs.sort((a, b) => a - b);
  return { p50: +xs[Math.floor(n / 2)].toFixed(1), p95: +xs[n - 1].toFixed(1) };
}

rmSync(DB, { force: true }); rmSync(DB + "-wal", { force: true }); rmSync(DB + "-shm", { force: true });
const idx = await openIndex(DB);
idx.setBrands([{ ...BRANDS[0], own: true }, ...BRANDS.slice(1, 40)]);
idx.addPrompts(Array.from({ length: PROMPTS }, (_, i) => ({ text: `What should I know about ${TOPICS[i % TOPICS.length]} when selling payments, case ${i}?`, topic: TOPICS[i % TOPICS.length] })));

const res = {};
let t = performance.now();
const c = await collect(idx, { engines: { bench: engine }, samples: SAMPLES, concurrency: 16 });
res.collect = { observations: c.done, ms: ms(t), perSec: Math.round(c.done / (ms(t) / 1000)) };

t = performance.now();
const cited = new Set(idx.all("select distinct canon_url u from citations").map((r) => r.u));
let passages = 0;
for (const p of corpus) {
  const canon = canonUrl(p.url);
  if (!cited.has(canon)) continue;
  const body = `<html><head><title>${p.url}</title></head><body><main>${p.paras.map((x) => `<h2>${x.heading}</h2><p>${x.text}</p>`).join("")}</main></body></html>`;
  passages += storePage(idx, canon, { ok: true, status: 200, url: p.url, body });
}
res.ingest = { pages: cited.size, passages, ms: ms(t), pagesPerSec: Math.round(cited.size / (ms(t) / 1000)) };

t = performance.now();
const a = attribute(idx);
res.attribute = { sentences: a.sentences, ms: ms(t), sentencesPerSec: Math.round(a.sentences / (ms(t) / 1000)) };
res.accuracy = evaluate(idx);

res.queries = {
  shareOfVoice: timeQuery(() => shareOfVoice(idx)),
  citedDomains: timeQuery(() => citedDomains(idx)),
  difficulty: timeQuery(() => difficulty(idx)),
  opportunities: timeQuery(() => opportunities(idx)),
  shareOfVoiceOneTopic: timeQuery(() => shareOfVoice(idx, { topic: "discount rate" })),
};
idx.close();
res.dbMB = +(statSync(DB).size / 1e6).toFixed(1);
res.config = { pages: PAGES, prompts: PROMPTS, samples: SAMPLES, noise: NOISE, node: process.version };
console.log(JSON.stringify(res, null, 2));
