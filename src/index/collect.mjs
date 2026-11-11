// The collection scheduler: prompts × engines × samples → observations.
// Per-engine concurrency and request spacing, retries with jittered exponential backoff
// that honour Retry-After, a hard budget checked before each paid call, and idempotent
// job keys so an interrupted run resumes without paying twice.

import { Index } from "./store.mjs";
import { canonUrl, domainOf, sourceType } from "./normalize.mjs";
import { compileBrands, mentions } from "./entities.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Turn a raw engine result into rows for the store. */
export function normalize(res, brands, compiled) {
  const seen = new Set();
  const citations = [];
  for (const c of res.citations || []) {
    const canon = c.resolve ? c.url : canonUrl(c.url);
    if (!canon) continue;
    const key = canon + "|" + (c.spanStart ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = c.domainHint || domainOf(canon) || "unknown";
    const probe = c.domainHint ? `https://${c.domainHint}/` : canon;
    citations.push({ position: citations.length + 1, url: c.url, canonUrl: canon, domain, sourceType: sourceType(probe, { title: c.title, brands }), title: c.title, spanStart: c.spanStart, spanEnd: c.spanEnd, support: c.support });
  }
  return { citations, mentions: mentions(res.answer || "", compiled) };
}

/**
 * @param {Index} index
 * @param {object} o
 * @param {Record<string, Function>} o.engines   name → (prompt, opts) => result
 * @param {Array} [o.prompts]                     defaults to every prompt in the index
 * @param {number} [o.samples=1]                   answers per prompt per engine
 * @param {number} [o.budgetUsd]                   hard ceiling for the run
 * @param {Record<string, number>} [o.estimateUsd] expected cost per call, per engine
 * @param {number} [o.concurrency=4]               in-flight calls per engine
 * @param {number} [o.minIntervalMs=0]             spacing between call starts, per engine
 * @param {number} [o.retries=4]
 * @param {number} [o.runId]                       resume an existing run
 */
export async function collect(index, o) {
  const prompts = o.prompts || index.prompts();
  const samples = o.samples ?? 1;
  const brands = index.brands();
  const compiled = compileBrands(brands);
  const runId = o.runId ?? index.startRun(o.budgetUsd ?? null, o.note ?? null);
  const stats = { runId, planned: 0, skipped: 0, done: 0, failed: 0, retries: 0, spentUsd: 0, stoppedForBudget: false, errors: [], ms: 0 };
  const t0 = performance.now();
  const queues = {};
  for (const [engine] of Object.entries(o.engines)) queues[engine] = [];
  for (const p of prompts) for (const engine of Object.keys(o.engines)) for (let s = 0; s < samples; s++) {
    const market = p.market || "us-en";
    const jobKey = Index.jobKey({ runId, promptId: p.id, engine, model: o.models?.[engine] || "default", market, sample: s });
    stats.planned++;
    if (index.hasJob(jobKey)) { stats.skipped++; continue; }
    queues[engine].push({ p, engine, sample: s, market, jobKey });
  }
  let reserved = 0;
  const canSpend = (engine) => {
    if (o.budgetUsd == null) return true;
    const est = o.estimateUsd?.[engine] ?? 0.02;
    if (stats.spentUsd + reserved + est > o.budgetUsd) { stats.stoppedForBudget = true; return false; }
    reserved += est;
    return true;
  };

  async function runJob(job) {
    const fn = o.engines[job.engine];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fn(job.p.text, { market: job.market, sample: job.sample, model: o.models?.[job.engine] });
        const norm = normalize(res, brands, compiled);
        index.addObservation({ runId, promptId: job.p.id, engine: job.engine, model: res.model, market: job.market, sample: job.sample, jobKey: job.jobKey, answer: res.answer || "", latencyMs: res.latencyMs, costUsd: res.costUsd, raw: o.keepRaw ? JSON.stringify(res.raw) : null, ...norm });
        stats.spentUsd += res.costUsd || 0;
        stats.done++;
        o.onProgress?.(stats);
        return;
      } catch (e) {
        if (e.retryable && attempt < (o.retries ?? 4)) {
          stats.retries++;
          await sleep(e.retryAfterMs ?? Math.min(30000, 500 * 2 ** attempt) * (0.5 + Math.random()));
          continue;
        }
        stats.failed++;
        if (stats.errors.length < 20) stats.errors.push(`${job.engine}: ${e.message}`);
        return;
      }
    }
  }

  async function lane(engine) {
    const q = queues[engine];
    const conc = o.concurrency ?? 4;
    let next = 0, lastStart = 0;
    async function worker() {
      while (next < q.length) {
        if (!canSpend(engine)) return;
        const job = q[next++];
        const gap = (o.minIntervalMs ?? 0) - (Date.now() - lastStart);
        if (gap > 0) await sleep(gap);
        lastStart = Date.now();
        const est = o.estimateUsd?.[engine] ?? 0.02;
        await runJob(job);
        if (o.budgetUsd != null) reserved -= est;
      }
    }
    await Promise.all(Array.from({ length: conc }, worker));
  }

  await Promise.all(Object.keys(queues).map(lane));
  stats.ms = Math.round(performance.now() - t0);
  index.endRun(runId, stats.stoppedForBudget ? "budget" : stats.failed && !stats.done ? "failed" : "done", stats.spentUsd);
  return stats;
}
