// Real-world study: runs getcited on live pages from a GitHub Actions runner
// (which has open internet) and writes every result to study/results/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { arena } from "../src/arena.mjs";
import { audit } from "../src/audit.mjs";
import { get } from "../src/fetch.mjs";
import { readHtml } from "../src/html.mjs";
import { xray } from "../src/xray.mjs";
import { truth } from "../src/truth.mjs";
import { resolveModel } from "../src/llm.mjs";
import { arenaHtml, xrayHtml } from "../src/views.mjs";
import { toHtml, toJson } from "../src/report.mjs";

const cfg = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const out = new URL("./results/", import.meta.url);
mkdirSync(out, { recursive: true });
const save = (name, data) => writeFileSync(new URL(name, out), typeof data === "string" ? data : JSON.stringify(data, null, 2));
let llm = null;
try { llm = resolveModel(cfg.model); } catch (e) { console.log("no live model:", e.message); }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
if (llm) {
  // Raw calls, saved as-is, so the live results can be checked by hand.
  const variants = [
    { url: `${llm.base}/chat/completions`, model: llm.model, headers: {} },
    { url: `${llm.base}/chat/completions`, model: llm.model, headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } },
    { url: "https://models.github.ai/inference/chat/completions", model: "openai/gpt-4o-mini", headers: { accept: "application/json" } },
    { url: "https://models.inference.ai.azure.com/chat/completions", model: "gpt-4o-mini", headers: {} },
  ];
  const probes = [];
  for (const v of variants) {
    try {
      const r = await fetch(v.url, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", authorization: `Bearer ${llm.key}`, ...v.headers }, body: JSON.stringify({ model: v.model, messages: [{ role: "user", content: "Reply with the single word: ready" }] }) });
      probes.push({ url: v.url, model: v.model, headers: v.headers, status: r.status, location: r.headers.get("location"), type: r.headers.get("content-type"), body: (await r.text()).slice(0, 600) });
    } catch (e) { probes.push({ url: v.url, error: e.message }); }
  }
  save("llm-probe.json", probes);
}
const summary = { ranAt: new Date().toISOString(), runner: process.env.RUNNER_OS || "local", model: llm?.label || null, questions: [], audits: [], xrays: [], truth: [], probe: [] };

for (const q of cfg.questions) {
  const sources = [...(q.mine ? [{ url: q.mine, mine: true }] : []), ...q.pages.map((url) => ({ url }))];
  console.log("arena:", q.ask);
  let r;
  try { r = await arena(q.ask, sources, { k: 5, llm, samples: cfg.samples }); }
  catch (e) { summary.questions.push({ ask: q.ask, error: e.message }); continue; }
  save(`arena-${slug(q.ask)}.json`, r);
  save(`arena-${slug(q.ask)}.html`, arenaHtml(r));
  summary.questions.push({
    ask: q.ask,
    standings: r.standings.map((s) => ({ label: s.label, url: s.url, mine: s.mine, ok: s.ok, error: s.error, share: s.share, bestRank: s.bestRank, passages: s.passages })),
    winner: r.context[0] ? { source: r.context[0].source, heading: r.context[0].heading, text: r.context[0].text } : null,
    gap: r.gap || null,
    live: r.live ? { model: r.live.model, error: r.live.error, samples: r.live.samples, share: r.live.share, answer: r.live.answer } : null,
  });
}

// Every page in the study: does the CDN let AI crawlers in?
const allPages = [...new Set(cfg.questions.flatMap((q) => [...(q.mine ? [q.mine] : []), ...q.pages]))];
for (const url of allPages) {
  console.log("audit:", url);
  const r = await audit(url, { pages: 1 });
  if (r.error) { summary.probe.push({ url, error: r.error }); continue; }
  const find = (id) => r.site.checks.find((c) => c.id === id);
  summary.probe.push({ url, score: r.score.overall, cdn: find("cdn-block")?.status, cdnEvidence: find("cdn-block")?.evidence, robots: find("robots-ai")?.status, robotsEvidence: find("robots-ai")?.evidence, training: find("robots-training")?.evidence, rendered: r.pages[0].checks.find((c) => c.id === "server-rendered")?.status });
  const page = await get(url);
  if (page.ok) { const x = xray(readHtml(page.body)); summary.xrays.push({ url, ...x.summary }); }
}

for (const url of cfg.audits) {
  const r = await audit(url, { pages: 3 });
  if (r.error) { summary.audits.push({ url, error: r.error }); continue; }
  save(`audit-${slug(new URL(url).host)}.json`, JSON.parse(toJson(r)));
  save(`audit-${slug(new URL(url).host)}.html`, toHtml(r));
  summary.audits.push({ url, score: r.score.overall, grade: r.score.grade, byCategory: r.score.byCategory, top: r.priorities.slice(0, 3).map((p) => ({ title: p.title, evidence: p.evidence })) });
  const page = await get(url);
  if (page.ok) { const x = xray(readHtml(page.body)); save(`xray-${slug(new URL(url).host)}.html`, xrayHtml(url, x)); }
}

if (llm) for (const t of cfg.truth) {
  try { summary.truth.push(await truth({ ...t, llm })); } catch (e) { summary.truth.push({ brand: t.brand, error: e.message }); }
}

save("summary.json", summary);
console.log(JSON.stringify({ questions: summary.questions.length, probes: summary.probe.length, audits: summary.audits.length, truth: summary.truth.length }));
