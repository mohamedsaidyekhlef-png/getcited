// `getcited test`: citation tests you can run in CI, like unit tests for AI search.
// A getcited.yml lists the questions your customers ask and what you expect:
// "my page is in the top 3 passages", "I hold at least 30% of the citation share".

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { arena, loadSource } from "./arena.mjs";
import { audit } from "./audit.mjs";
import { truth } from "./truth.mjs";
import { parseYaml } from "./yaml.mjs";

export async function readSpec(path) {
  const src = await readFile(path, "utf8");
  const spec = /\.json$/i.test(path) ? JSON.parse(src) : parseYaml(src);
  if (!spec || typeof spec !== "object") throw new Error(`${path} is empty`);
  if (!spec.site && !(spec.questions || []).every((q) => q.page)) throw new Error(`${path}: set "site:" (your page) or a "page:" on every question`);
  return { ...spec, _dir: dirname(resolve(path)) };
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function sourceOf(ref, dir, mine) {
  const s = String(ref);
  if (/^https?:\/\//i.test(s)) return { url: s, mine };
  const file = isAbsolute(s) ? s : resolve(dir, s);
  return { file, url: s, mine };
}

/** Parse one expectation: cited | top1 | first | top<N> | share>=X | share >= 30% ; optional "live " prefix. */
export function parseExpect(e) {
  const raw = String(e).trim();
  const live = /^live[\s:]+/i.test(raw);
  const s = raw.replace(/^live[\s:]+/i, "").toLowerCase().replace(/\s+/g, "");
  if (s === "cited") return { live, kind: "cited", raw };
  if (s === "first" || s === "top1" || s === "won") return { live, kind: "top", n: 1, raw };
  let m = /^top(\d+)$/.exec(s);
  if (m) return { live, kind: "top", n: Number(m[1]), raw };
  m = /^share(>=|>)(\d+(?:\.\d+)?)(%?)$/.exec(s);
  if (m) return { live, kind: "share", op: m[1], min: m[3] ? Number(m[2]) / 100 : Number(m[2]), raw };
  throw new Error(`unknown expectation "${raw}". Use cited, top1, top3, share>=0.3 (or share>=30%), optionally prefixed with "live".`);
}

function check(exp, result) {
  if (exp.live) {
    const L = result.live;
    if (!L) return { status: "skip", detail: "needs --model for a live check" };
    if (L.error) return { status: "fail", detail: L.error };
    const me = L.share.find((s) => s.mine);
    if (exp.kind === "cited") return me.citedIn > 0 ? { status: "pass", detail: `cited in ${me.citedIn}/${L.samples} ${L.model} answers` } : { status: "fail", detail: `not cited in ${L.samples} ${L.model} answers; cited: ${L.share.filter((s) => s.citedIn).map((s) => s.label).join(", ") || "nobody"}` };
    if (exp.kind === "share") { const ok = exp.op === ">" ? me.share > exp.min : me.share >= exp.min; return { status: ok ? "pass" : "fail", detail: `live share ${pct(me.share)} (want ${exp.op}${pct(exp.min)})` }; }
    if (exp.kind === "top") { const top = L.share[0]; const ok = top && top.mine && top.citedIn > 0; return { status: ok ? "pass" : "fail", detail: ok ? "most-cited source" : `most cited: ${top?.label}` }; }
  }
  const g = result.gap;
  if (exp.kind === "cited") return g.inContext > 0 ? { status: "pass", detail: `${g.inContext} passage(s) in the top ${result.k}, best rank ${g.rank}` } : { status: "fail", detail: `no passage in the top ${result.k}${g.rank ? ` (best rank ${g.rank})` : ""}; ${result.context[0] ? `winner: ${result.context[0].source}` : ""}` };
  if (exp.kind === "top") return g.rank && g.rank <= exp.n ? { status: "pass", detail: `rank ${g.rank}` } : { status: "fail", detail: `rank ${g.rank ?? "–"}, want top ${exp.n}; winner: ${result.context[0]?.source || "–"}` };
  const ok = exp.op === ">" ? g.share > exp.min : g.share >= exp.min;
  return { status: ok ? "pass" : "fail", detail: `share ${pct(g.share)} (want ${exp.op}${pct(exp.min)})` };
}

const pct = (x) => `${Math.round(x * 100)}%`;

export async function runSpec(spec, { llm, judge, onResult = () => {} } = {}) {
  const dir = spec._dir || process.cwd();
  const cache = new Map();
  const load = (src) => {
    const key = src.file || src.url;
    if (!cache.has(key)) cache.set(key, loadSource(src));
    return cache.get(key).then((r) => ({ ...r, mine: src.mine, url: src.url }));
  };
  const tests = [];
  const add = (t) => { tests.push(t); onResult(t); };

  if (spec.min_score != null && spec.site) {
    const r = /^https?:/i.test(spec.site) ? await audit(spec.site, { probeBots: spec.probe_bots !== false }) : await audit("", { file: resolve(dir, spec.site) });
    if (r.error) add({ name: `audit score ≥ ${spec.min_score}`, kind: "audit", status: "fail", detail: `couldn't load ${spec.site}: ${r.error}` });
    else add({ name: `audit score ≥ ${spec.min_score}`, kind: "audit", status: r.score.overall >= spec.min_score ? "pass" : "fail", detail: `${r.score.overall}/100${r.priorities[0] ? `; top fix: ${r.priorities[0].title}` : ""}`, score: r.score.overall });
  }

  const questions = asList(spec.questions);
  const results = [];
  for (const q of questions) {
    const ask = typeof q === "string" ? q : q.ask;
    if (!ask) throw new Error("every question needs ask:");
    const mine = sourceOf((typeof q === "object" && q.page) || spec.site, dir, true);
    const rivals = asList((typeof q === "object" && q.competitors) || spec.competitors).map((c) => sourceOf(c, dir, false));
    const sources = [mine, ...rivals];
    const loaded = await Promise.all(sources.map(load));
    const result = await arena(ask, sources, { k: (typeof q === "object" && q.k) || spec.k || 5, llm, samples: spec.samples || 3, loaded });
    results.push(result);
    const exps = asList((typeof q === "object" && q.expect) || "cited").map(parseExpect);
    for (const e of exps) add({ name: `${ask}  →  ${e.raw}`, kind: e.live ? "live" : "arena", question: ask, ...check(e, result), advice: result.gap?.advice?.[0] });
  }

  if (spec.brand?.facts && spec.truth?.min_accuracy != null) {
    if (!llm) add({ name: `AI is ≥ ${pct(spec.truth.min_accuracy)} right about ${spec.brand.name}`, kind: "truth", status: "skip", detail: "needs --model" });
    else {
      try {
        const t = await truth({ brand: spec.brand.name, site: spec.site, facts: asList(spec.brand.facts).filter((f) => !/^TODO\b/i.test(String(f))), llm, judge });
        const ok = t.accuracy !== null && t.accuracy >= spec.truth.min_accuracy;
        add({ name: `AI is ≥ ${pct(spec.truth.min_accuracy)} right about ${spec.brand.name}`, kind: "truth", status: ok ? "pass" : "fail", detail: t.summary, advice: t.fixes[0], truth: t });
      } catch (e) { add({ name: `AI is right about ${spec.brand.name}`, kind: "truth", status: "fail", detail: e.message }); }
    }
  }

  const passed = tests.filter((t) => t.status === "pass").length;
  const failed = tests.filter((t) => t.status === "fail").length;
  const skipped = tests.filter((t) => t.status === "skip").length;
  const mineShare = results.length ? results.reduce((a, r) => a + (r.gap?.share || 0), 0) / results.length : null;
  return { tool: "getcited", ranAt: new Date().toISOString(), site: spec.site, model: llm?.label || null, passed, failed, skipped, tests, citedIn: results.filter((r) => r.gap?.inContext).length, questions: results.length, averageShare: mineShare === null ? null : +mineShare.toFixed(3), results };
}

/** shields.io endpoint JSON: https://img.shields.io/endpoint?url=<raw url of this file> */
export function badge(run) {
  const total = run.passed + run.failed;
  const color = !total ? "lightgrey" : run.failed === 0 ? "brightgreen" : run.passed / total >= 0.5 ? "yellow" : "red";
  return { schemaVersion: 1, label: "AI citation tests", message: total ? `${run.passed}/${total} passing` : "no tests", color };
}
