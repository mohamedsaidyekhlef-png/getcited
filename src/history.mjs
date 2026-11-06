// Citation regression monitoring: every `getcited test` run is saved, and each
// new run is compared with the previous one. The diff says what changed and why:
// a passage that dropped out of the context, a competitor that took the top
// slot, a page that stopped loading, an audit check that started failing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "./text.mjs";

/** Keep only what a later diff needs (no full page text). */
export function snapshot(run) {
  return {
    tool: "getcited", kind: "run", ranAt: run.ranAt, site: run.site, model: run.model,
    passed: run.passed, failed: run.failed, skipped: run.skipped, averageShare: run.averageShare,
    tests: run.tests.map((t) => ({ name: t.name, kind: t.kind, status: t.status, detail: t.detail, score: t.score, failing: t.failing })),
    questions: (run.results || []).map((r) => ({
      question: r.question,
      share: r.gap?.share ?? null, rank: r.gap?.rank ?? null, inContext: r.gap?.inContext ?? 0,
      winner: r.context[0]?.source || null,
      top: r.context.map((p) => ({ source: p.source, mine: p.mine, heading: p.heading, id: hash(`${p.source}|${p.heading}|${p.text}`).toString(36) })),
      sources: r.standings.map((s) => ({ label: s.label, mine: s.mine, ok: s.ok, error: s.error, share: s.share, rank: s.bestRank })),
    })),
  };
}

export function saveRun(dir, run) {
  mkdirSync(dir, { recursive: true });
  const snap = snapshot(run);
  const file = join(dir, `${snap.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(snap, null, 2));
  return file;
}

export function previousRun(dir) {
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return null; }
  for (let i = files.length - 1; i >= 0; i--) {
    try { const j = JSON.parse(readFileSync(join(dir, files[i]), "utf8")); if (j.kind === "run") return { file: join(dir, files[i]), run: j }; } catch { /* skip */ }
  }
  return null;
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;

/** Compare two snapshots. Returns changes ordered regressions first. */
export function diffRuns(prev, cur) {
  const changes = [];
  const add = (severity, question, text) => changes.push({ severity, question, text });
  const pq = new Map(prev.questions.map((q) => [q.question, q]));
  for (const q of cur.questions) {
    const p = pq.get(q.question);
    if (!p) { add("info", q.question, "new question"); continue; }
    const meNow = q.sources.find((s) => s.mine), meThen = p.sources.find((s) => s.mine);
    if (meThen?.ok && meNow && !meNow.ok) add("regression", q.question, `your page stopped loading (${meNow.error}). Engines can't cite it until it's back.`);
    if (meThen && !meThen.ok && meNow?.ok) add("improvement", q.question, "your page loads again");
    const ds = (q.share ?? 0) - (p.share ?? 0);
    if (Math.abs(ds) >= 0.05) add(ds < 0 ? "regression" : "improvement", q.question, `citation share ${pct(p.share)} → ${pct(q.share)}`);
    if (p.rank !== q.rank && (p.rank || q.rank)) {
      const worse = (q.rank ?? 1e9) > (p.rank ?? 1e9);
      if ((p.rank ?? 99) <= 10 || (q.rank ?? 99) <= 10) add(worse ? "regression" : "improvement", q.question, `best passage rank #${p.rank ?? "–"} → #${q.rank ?? "–"}`);
    }
    const mineThen = new Map(p.top.filter((x) => x.mine).map((x) => [x.id, x]));
    const mineNow = new Set(q.top.filter((x) => x.mine).map((x) => x.id));
    for (const [id, x] of mineThen) if (!mineNow.has(id)) add("regression", q.question, `your passage "${x.heading || "untitled section"}" dropped out of the context (edited, moved or outranked)`);
    if (p.winner !== q.winner) add(q.top[0]?.mine ? "improvement" : p.top[0]?.mine ? "regression" : "info", q.question, `top passage now from ${q.winner || "nobody"} (was ${p.winner || "nobody"})`);
    const thenLabels = new Set(p.top.map((x) => x.source));
    for (const s of new Set(q.top.filter((x) => !x.mine && !thenLabels.has(x.source)).map((x) => x.source))) add("info", q.question, `${s} entered the context`);
    for (const s of q.sources) {
      const was = p.sources.find((x) => x.label === s.label);
      if (!s.mine && was && was.ok && !s.ok) add("info", q.question, `competitor ${s.label} no longer loads (${s.error})`);
    }
  }
  const pt = new Map(prev.tests.map((t) => [t.name, t]));
  for (const t of cur.tests) {
    const p = pt.get(t.name);
    if (!p) continue;
    if (p.status === "pass" && t.status === "fail") add("regression", null, `test now failing: ${t.name} (${t.detail})`);
    if (p.status === "fail" && t.status === "pass") add("improvement", null, `test now passing: ${t.name}`);
    if (t.kind === "audit" && p.score != null && t.score != null && t.score !== p.score) add(t.score < p.score ? "regression" : "improvement", null, `audit score ${p.score} → ${t.score}`);
    if (t.kind === "audit" && p.failing && t.failing) for (const c of t.failing.filter((c) => !p.failing.includes(c))) add("regression", null, `audit check started failing: ${c}`);
  }
  const order = { regression: 0, improvement: 1, info: 2 };
  changes.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    since: prev.ranAt,
    regressions: changes.filter((c) => c.severity === "regression").length,
    improvements: changes.filter((c) => c.severity === "improvement").length,
    changes,
  };
}
