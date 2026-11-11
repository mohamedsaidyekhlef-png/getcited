// getcited index: the AI Answer Index from the command line.
//
//   getcited index init [--vertical structured-settlements] [index.json]
//   getcited index run [index.json] [--engines a,b] [--samples n] [--budget usd] [--dry]
//   getcited index collect | crawl | attribute | report [index.json] [--json]
//
// Keys come from the environment: PERPLEXITY_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
// ANTHROPIC_API_KEY. Engines without a key are skipped and reported.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openIndex } from "./store.mjs";
import { collect } from "./collect.mjs";
import { crawl } from "./crawl.mjs";
import { attribute, evaluate } from "./attribute.mjs";
import { summary, volatility } from "./metrics.mjs";
import { ENGINES, ENGINE_KEYS } from "./engines.mjs";

const SEEDS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "seeds");
const pct = (x) => `${Math.round(x * 100)}%`;

function args(argv) {
  const a = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--engines") a.engines = argv[++i].split(",");
    else if (k === "--samples") a.samples = Number(argv[++i]);
    else if (k === "--budget") a.budget = Number(argv[++i]);
    else if (k === "--vertical") a.vertical = argv[++i];
    else if (k === "--json") a.json = true;
    else if (k === "--dry") a.dry = true;
    else if (k === "--concurrency") a.concurrency = Number(argv[++i]);
    else a.pos.push(k);
  }
  return a;
}

function load(file) {
  if (!existsSync(file)) throw new Error(`${file} not found. Create one with: getcited index init`);
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  cfg.db = resolve(dirname(resolve(file)), cfg.db || "getcited-index.db");
  return cfg;
}

async function open(cfg) {
  const idx = await openIndex(cfg.db);
  idx.setBrands(cfg.brands || []);
  idx.addPrompts(cfg.prompts || [], cfg.market || "us-en");
  return idx;
}

function plan(cfg, a) {
  const wanted = a.engines || cfg.engines || Object.keys(ENGINES);
  const ready = wanted.filter((e) => ENGINES[e] && process.env[ENGINE_KEYS[e]]);
  const missing = wanted.filter((e) => !ready.includes(e));
  const samples = a.samples ?? cfg.samples ?? 1;
  const n = (cfg.prompts || []).length;
  const est = ready.reduce((s, e) => s + n * samples * (cfg.estimateUsd?.[e] ?? 0.02), 0);
  return { ready, missing, samples, calls: ready.length * n * samples, estimateUsd: +est.toFixed(2), budgetUsd: a.budget ?? cfg.budgetUsd ?? null };
}

function printReport(s, extra = {}) {
  const L = [];
  L.push(`\n${s.answers} answers · ${s.prompts} prompts · ${s.engines} engines · $${s.cost ?? 0} · ${s.first?.slice(0, 16) ?? "–"} → ${s.last?.slice(0, 16) ?? "–"}`);
  L.push("\nShare of voice (mention rate, 95% interval)");
  for (const r of s.shareOfVoice) L.push(`  ${(r.own ? "▶ " : "  ") + r.brand.padEnd(30)} ${pct(r.mentionRate.p).padStart(4)}  [${pct(r.mentionRate.lo)}–${pct(r.mentionRate.hi)}]  rank ${r.avgRank ?? "–"}  cited ${pct(r.citationShare)}`);
  L.push("\nMost cited sources");
  for (const d of s.domains.slice(0, 12)) L.push(`  ${d.domain.padEnd(34)} ${String(d.citations).padStart(4)}  ${pct(d.share).padStart(4)}  ${d.type.padEnd(11)} ${d.prompts} prompts, ${d.engines} engines`);
  L.push("\nHardest prompts (citation concentration, HHI)");
  for (const d of s.difficulty.slice(0, 8)) L.push(`  ${String(d.hhi).padStart(5)} ${d.level.padEnd(12)} ${d.prompt.slice(0, 70)}  → ${d.leader} ${pct(d.leaderShare)}`);
  if (s.opportunities.length) {
    L.push("\nPlacement opportunities (cited where competitors appear and you don't)");
    for (const o of s.opportunities.slice(0, 10)) L.push(`  ${String(o.answers).padStart(3)} answers  ${o.type.padEnd(9)} ${o.url.slice(0, 80)}${o.competitors ? `  (${o.competitors})` : ""}`);
  }
  if (extra.eval?.labelled) L.push(`\nAttribution vs engine labels: ${pct(extra.eval.accuracy)} of ${extra.eval.labelled} labelled sentences (precision ${pct(extra.eval.precision)}, coverage ${pct(extra.eval.coverage)})`);
  if (extra.vol?.rows?.length) L.push(`Volatility since last run: ${pct(extra.vol.mean)} of cited domains changed on average`);
  return L.join("\n") + "\n";
}

export async function main(argv) {
  const [cmd = "help", ...rest] = argv;
  const a = args(rest);
  const file = a.pos[0] || "index.json";
  if (cmd === "help" || cmd === "--help") {
    console.log("getcited index init [--vertical structured-settlements] [index.json]\ngetcited index run|collect|crawl|attribute|report [index.json] [--engines perplexity,openai,gemini,anthropic] [--samples n] [--budget usd] [--dry] [--json]");
    return;
  }
  if (cmd === "init") {
    if (existsSync(file)) throw new Error(`${file} already exists`);
    const seed = a.vertical ? JSON.parse(readFileSync(join(SEEDS, `${a.vertical}.json`), "utf8")) : { name: "My index", db: "getcited-index.db", market: "us-en", engines: Object.keys(ENGINES), samples: 2, budgetUsd: 5, brands: [{ name: "Your brand", domain: "example.com", own: true }], prompts: [{ topic: "General", text: "What is the best ... for ...?" }] };
    writeFileSync(file, JSON.stringify(seed, null, 2) + "\n");
    console.log(`Wrote ${file}: ${seed.prompts.length} prompts, ${seed.brands.length} brands. Next: getcited index run ${file} --dry`);
    return;
  }
  const cfg = load(file);
  const p = plan(cfg, a);
  if (["run", "collect"].includes(cmd)) {
    console.error(`Plan: ${p.calls} answers from ${p.ready.join(", ") || "no engines"} (${p.samples} samples), estimated $${p.estimateUsd}${p.budgetUsd != null ? `, budget $${p.budgetUsd}` : ""}.${p.missing.length ? ` Skipped (no key): ${p.missing.map((e) => `${e} (${ENGINE_KEYS[e]})`).join(", ")}.` : ""}`);
    if (a.dry) return;
    if (!p.ready.length) { process.exitCode = 1; return; }
  }
  const idx = await open(cfg);
  try {
    const out = {};
    if (["run", "collect"].includes(cmd)) {
      const engines = Object.fromEntries(p.ready.map((e) => [e, ENGINES[e]]));
      out.collect = await collect(idx, { engines, samples: p.samples, budgetUsd: p.budgetUsd, estimateUsd: cfg.estimateUsd, concurrency: a.concurrency ?? 3, onProgress: (s) => process.stderr.write(`\r  collected ${s.done}/${s.planned - s.skipped}  failed ${s.failed}  $${s.spentUsd.toFixed(3)}   `) });
      process.stderr.write("\n");
      if (out.collect.errors.length) console.error("  errors:\n   " + out.collect.errors.slice(0, 5).join("\n   "));
    }
    if (["run", "crawl"].includes(cmd)) out.crawl = await crawl(idx, { onProgress: (s) => process.stderr.write(`\r  crawled ${s.pages} pages, ${s.passages} passages, ${s.failed} failed   `) });
    if (["run", "crawl"].includes(cmd)) process.stderr.write("\n");
    if (["run", "attribute"].includes(cmd)) out.attribute = attribute(idx);
    if (["run", "report", "attribute"].includes(cmd)) {
      const s = summary(idx);
      const ev = evaluate(idx);
      const vol = volatility(idx);
      if (a.json) console.log(JSON.stringify({ ...out, summary: s, attribution: ev, volatility: vol }, null, 2));
      else process.stdout.write(printReport(s, { eval: ev, vol }));
    } else if (a.json) console.log(JSON.stringify(out, null, 2));
  } finally { idx.close(); }
}
