// `live`: ask the real answer engines now. Collects one answer per prompt per engine
// into a throwaway in-memory index, crawls the cited pages, attributes each answer
// sentence to the passage it came from, and returns who was named, who was cited,
// the passages that won, and where to get placed. Real answers, not a simulation.

import { openIndex } from "./index/store.mjs";
import { collect } from "./index/collect.mjs";
import { crawl } from "./index/crawl.mjs";
import { attribute, winningPassages, evaluate } from "./index/attribute.mjs";
import { shareOfVoice, citedDomains, opportunities } from "./index/metrics.mjs";
import { discover } from "./index/entities.mjs";
import { ENGINES, ENGINE_KEYS, available } from "./index/engines.mjs";
import { domainOf } from "./index/normalize.mjs";

export function liveEngines(env = process.env) { return available(env); }

export async function live({ prompts, brand, competitors = [], engines, market = "us-en", maxPages = 20, env = process.env }) {
  const ready = (engines?.length ? engines : Object.keys(ENGINES)).filter((e) => ENGINES[e] && env[ENGINE_KEYS[e]]);
  if (!ready.length) return { error: `No answer-engine API key is configured. Set one or more of ${Object.values(ENGINE_KEYS).join(", ")} where getcited runs (your own keys locally, or the hosted plan).` };
  const idx = await openIndex(":memory:");
  const own = { name: brand?.name || domainOf(brand?.domain ? `https://${brand.domain}` : "") || "You", domain: brand?.domain?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""), own: true };
  const comps = competitors.map((c) => (typeof c === "string" ? { name: c.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""), domain: c.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") } : c));
  idx.setBrands([own, ...comps]);
  const ps = idx.addPrompts(prompts.slice(0, 5).map((t) => ({ text: t })), market);
  const engineFns = Object.fromEntries(ready.map((e) => [e, (p, o) => ENGINES[e](p, { ...o, apiKey: env[ENGINE_KEYS[e]] })]));
  const c = await collect(idx, { engines: engineFns, samples: 1, concurrency: 3, retries: 2 });
  await crawl(idx, { limit: maxPages, perHostDelayMs: 300, concurrency: 8 });
  attribute(idx);
  const answers = idx.all(`select o.id, o.engine, o.model, p.text prompt, o.answer, o.cost_usd from observations o join prompts p on p.id = o.prompt_id order by p.id, o.engine`).map((o) => ({
    engine: o.engine, model: o.model, prompt: o.prompt, excerpt: o.answer.replace(/\s+/g, " ").slice(0, 600),
    named: idx.all("select brand, list_rank from mentions where observation_id = ? order by first_offset", o.id).map((m) => m.brand),
    newNames: discover(o.answer, [own.name, ...comps.map((x) => x.name)]).slice(0, 5).map((d) => d.name),
    cited: idx.all("select canon_url url, domain, source_type type, title from citations where observation_id = ? order by position", o.id),
  }));
  const top = citedDomains(idx, {}, 12);
  const winners = idx.all(`select c.canon_url url, c.domain, c.source_type type, count(*) n from citations c where c.source_type != 'own' group by c.canon_url order by n desc limit 3`)
    .map((w) => ({ ...w, passages: winningPassages(idx, w.url, 2).map((p) => ({ heading: p.heading, text: p.text.slice(0, 400), uses: p.uses })) }))
    .filter((w) => w.passages.length);
  const result = {
    measuredAt: new Date().toISOString(), engines: ready, market, collected: c.done, failed: c.failed, errors: c.errors.slice(0, 5), costUsd: +c.spentUsd.toFixed(4),
    shareOfVoice: shareOfVoice(idx).map((r) => ({ brand: r.brand, own: r.own, mentioned: r.mentionRate.k ?? Math.round(r.mentionRate.p * r.mentionRate.n), of: r.mentionRate.n, avgRank: r.avgRank, citations: r.citations })),
    sources: top, winners, opportunities: opportunities(idx, {}, 10), answers, attribution: evaluate(idx),
  };
  idx.close();
  return result;
}

const pct = (x) => `${Math.round(x * 100)}%`;
export function liveMarkdown(r) {
  if (r.error) return r.error;
  const L = [];
  const me = r.shareOfVoice.find((s) => s.own);
  L.push(`**getcited live · ${r.collected} real answers from ${r.engines.join(", ")}**`);
  L.push(`Asked ${r.measuredAt.replace("T", " ").slice(0, 16)} UTC, market ${r.market}, cost $${r.costUsd}.${r.failed ? ` ${r.failed} calls failed.` : ""}`);
  if (me) L.push(`**${me.brand} was named in ${me.mentioned} of ${me.of} answers**${me.avgRank ? `, average position ${me.avgRank}` : ""}; its site was cited ${me.citations} times.`);
  L.push("", "| Brand | Named in | Avg position | Site cited |", "|---|---:|---:|---:|");
  for (const s of r.shareOfVoice) L.push(`| ${s.own ? `**${s.brand}** (you)` : s.brand} | ${s.mentioned}/${s.of} | ${s.avgRank ?? "–"} | ${s.citations} |`);
  L.push("", "| Most cited source | Type | Citations | Engines |", "|---|---|---:|---:|");
  for (const d of r.sources.slice(0, 8)) L.push(`| ${d.domain} | ${d.type} | ${d.citations} | ${d.engines} |`);
  for (const w of r.winners) {
    L.push("", `**Why ${w.domain} gets cited** (${w.type}, ${w.n} citations): the passage the answers were built from`);
    L.push(`> ${w.passages[0].heading ? `**${w.passages[0].heading}**: ` : ""}${w.passages[0].text.slice(0, 300)}`);
  }
  if (r.opportunities.length) {
    L.push("", "**Where to get placed** (cited in answers that name a competitor but not you)");
    for (const o of r.opportunities.slice(0, 6)) L.push(`- ${o.url} (${o.type}, ${o.answers} answers${o.competitors ? `, names ${o.competitors}` : ""})`);
  }
  L.push("", "**The answers**");
  for (const a of r.answers) L.push(`- *${a.engine}* · “${a.prompt}”: names ${a.named.join(", ") || "none of the tracked brands"}${a.newNames.length ? `; also names ${a.newNames.join(", ")}` : ""}; cites ${a.cited.slice(0, 4).map((c) => c.domain).join(", ") || "nothing"}.`);
  return L.join("\n");
}
