import { test } from "node:test";
import assert from "node:assert/strict";
import { openIndex } from "../src/index/store.mjs";
import { collect } from "../src/index/collect.mjs";
import { crawl } from "../src/index/crawl.mjs";
import { attribute, evaluate, winningPassages } from "../src/index/attribute.mjs";
import { shareOfVoice, difficulty, opportunities, volatility, wilson, citedDomains } from "../src/index/metrics.mjs";
import { mockEngine, EngineError, perplexity, openai, gemini, anthropic } from "../src/index/engines.mjs";
import { canonUrl, domainOf, sourceType } from "../src/index/normalize.mjs";
import { mentions, compileBrands, discover } from "../src/index/entities.mjs";

const PAGES = {
  "https://peachtreefinancial.com/cost": { title: "Cost of selling", brand: "Peachtree", paras: [
    ["Court fees", "Court fees for selling a structured settlement usually range from $100 to $500 depending on the state."],
    ["Discount rate", "The discount rate is the largest cost and usually runs from 9% to 18% a year."]] },
  "https://www.reddit.com/r/personalfinance/comments/abc": { title: "Sold my structured settlement", paras: [
    ["Experience", "I sold part of my structured settlement and the judge approved it after about 60 days."]] },
  "https://www.bestcompanies.com/best-structured-settlement-companies": { title: "Best structured settlement companies 2026", brand: "JG Wentworth", paras: [
    ["Top picks", "JG Wentworth and Peachtree are the largest structured settlement buyers in the United States."]] },
  "https://settlementdecisions.com/": { title: "SettlementDecisions", brand: "SettlementDecisions", paras: [
    ["Compare offers", "Compare written offers from licensed buyers before you sell your structured settlement payments."]] },
};
const html = (p) => `<html><head><title>${p.title}</title></head><body><main>${p.paras.map(([h, t]) => `<h2>${h}</h2><p>${t}</p>`).join("")}</main></body></html>`;
const fakeFetch = async (url) => { const k = Object.keys(PAGES).find((u) => canonUrl(u) === url); return k ? { ok: true, status: 200, url: k, body: html(PAGES[k]), ms: 1 } : { ok: false, status: 404, url, body: "", ms: 1 }; };
const corpus = Object.entries(PAGES).flatMap(([url, p]) => p.paras.map(([, t]) => ({ url, title: p.title, text: t, brand: p.brand })));

async function build() {
  const idx = await openIndex(":memory:");
  idx.setBrands([
    { name: "SettlementDecisions", domain: "settlementdecisions.com", own: true },
    { name: "Peachtree", domain: "peachtreefinancial.com", aliases: ["Peachtree Financial"] },
    { name: "JG Wentworth", domain: "jgwentworth.com" },
  ]);
  idx.addPrompts([
    { text: "How much does it cost to sell a structured settlement?", topic: "Cost" },
    { text: "Who are the best structured settlement buyers?", topic: "Buyers" },
    { text: "How long does a structured settlement sale take with court approval?", topic: "Process" },
  ]);
  return idx;
}

test("normalize: canonical URLs, registrable domains and source types", () => {
  assert.equal(canonUrl("http://WWW.Example.com/a/?utm_source=x&b=2&a=1#top"), "https://example.com/a?a=1&b=2");
  assert.equal(canonUrl("https://m.example.com/x/amp/"), "https://example.com/x");
  assert.equal(canonUrl("https://youtube.com/watch?v=abc&si=xyz"), "https://youtube.com/watch?v=abc");
  assert.equal(domainOf("https://news.bbc.co.uk/x"), "bbc.co.uk");
  assert.equal(sourceType("https://www.reddit.com/r/x"), "forum");
  assert.equal(sourceType("https://irs.gov/x"), "government");
  assert.equal(sourceType("https://foo.com/best-structured-settlement-companies"), "list");
  assert.equal(sourceType("https://shop.acme.com/x", { brands: [{ domain: "acme.com", own: true }] }), "own");
});

test("entities: first mention, count and list rank; discovery of untracked names", () => {
  const c = compileBrands([{ name: "Peachtree", aliases: ["Peachtree Financial"] }, { name: "JG Wentworth" }]);
  const text = "Top buyers:\n1. **JG Wentworth**: large.\n2. Peachtree Financial: fast.\n3. Stone Street Capital\nPeachtree again.";
  const m = mentions(text, c);
  assert.deepEqual(m.map((x) => [x.brand, x.listRank, x.count]), [["JG Wentworth", 1, 1], ["Peachtree", 2, 2]]);
  assert.ok(discover(text, ["JG Wentworth", "Peachtree Financial"]).some((d) => d.name === "Stone Street Capital"));
});

test("collect: retries, budget stop and idempotent resume", async () => {
  const idx = await build();
  let fails = 0;
  const flaky = async (p, o) => { if (fails++ < 2) throw new EngineError("HTTP 429", { retryable: true, retryAfterMs: 1 }); return mockEngine(corpus)(p, o); };
  const s = await collect(idx, { engines: { a: mockEngine(corpus), b: flaky }, samples: 2 });
  assert.equal(s.done, 12);
  assert.equal(s.retries, 2);
  const again = await collect(idx, { engines: { a: mockEngine(corpus), b: flaky }, samples: 2, runId: s.runId });
  assert.equal(again.skipped, 12);
  assert.equal(again.done, 0);
  const capped = await collect(idx, { engines: { a: mockEngine(corpus) }, samples: 4, budgetUsd: 0.005, estimateUsd: { a: 0.001 } });
  assert.ok(capped.stoppedForBudget);
  assert.ok(capped.done <= 5);
});

test("crawl + attribute: answers are traced to the passage they came from, measured against labels", async () => {
  const idx = await build();
  await collect(idx, { engines: { mock: mockEngine(corpus) }, samples: 3 });
  const c = await crawl(idx, { fetchImpl: fakeFetch, perHostDelayMs: 0 });
  assert.equal(c.pages, 4);
  assert.ok(c.passages >= 5);
  const a = attribute(idx);
  assert.ok(a.attributed > 0);
  const ev = evaluate(idx);
  assert.ok(ev.labelled > 0);
  assert.ok(ev.accuracy >= 0.8, `attribution accuracy ${ev.accuracy}`);
  const wp = winningPassages(idx, canonUrl("https://peachtreefinancial.com/cost"));
  assert.ok(wp.length && wp[0].uses > 0);
});

test("metrics: share of voice with intervals, difficulty, opportunities, volatility", async () => {
  const idx = await build();
  await collect(idx, { engines: { mock: mockEngine(corpus, { seed: 1 }) }, samples: 3 });
  await collect(idx, { engines: { mock: mockEngine(corpus, { seed: 7 }) }, samples: 3 });
  const sov = shareOfVoice(idx);
  assert.equal(sov.length, 3);
  for (const r of sov) assert.ok(r.mentionRate.lo <= r.mentionRate.p && r.mentionRate.p <= r.mentionRate.hi);
  const w = wilson(5, 10);
  assert.ok(Math.abs(w.lo - 0.237) < 0.01 && Math.abs(w.hi - 0.763) < 0.01);
  const d = difficulty(idx);
  assert.ok(d.every((x) => x.hhi > 0 && x.hhi <= 10000));
  assert.ok(citedDomains(idx).length >= 3);
  const opp = opportunities(idx);
  assert.ok(opp.every((o) => !["own", "competitor"].includes(o.type)));
  const v = volatility(idx);
  assert.equal(v.runs.length, 2);
});

test("engine adapters parse each provider's documented response shape", async () => {
  const fake = (body) => async () => new Response(JSON.stringify(body), { status: 200 });
  const px = await perplexity("q", { apiKey: "k", fetchImpl: fake({ output: [
    { type: "search_results", results: [{ id: 1, url: "https://a.com/x", title: "A" }, { id: 2, url: "https://b.com/y", title: "B" }] },
    { type: "message", content: [{ type: "output_text", text: "Fees run $100 to $500 [1]. Rates vary [2][1]." }] }] }) });
  assert.deepEqual(px.citations.map((c) => c.url), ["https://a.com/x", "https://b.com/y", "https://a.com/x"]);
  assert.match(px.citations[0].support, /Fees run/);
  const oa = await openai("q", { apiKey: "k", fetchImpl: fake({ model: "m", output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "Rates run 9% to 18%.", annotations: [{ type: "url_citation", url: "https://c.com/z", title: "C", start_index: 0, end_index: 20 }] }] }], usage: { input_tokens: 1000, output_tokens: 100 } }) });
  assert.equal(oa.citations[0].url, "https://c.com/z");
  assert.ok(oa.costUsd > 0);
  const ge = await gemini("q", { apiKey: "k", fetchImpl: fake({ candidates: [{ content: { parts: [{ text: "Judges approve sales. Fees vary." }] }, groundingMetadata: { webSearchQueries: ["x"], groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "irs.gov" } }], groundingSupports: [{ segment: { startIndex: 0, endIndex: 21, text: "Judges approve sales." }, groundingChunkIndices: [0] }] } }] }) });
  assert.equal(ge.citations[0].domainHint, "irs.gov");
  assert.ok(ge.citations[0].resolve);
  assert.equal(ge.citations[0].spanStart, 0);
  const an = await anthropic("q", { apiKey: "k", fetchImpl: fake({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "Based on results, " }, { type: "text", text: "a 40% excise tax applies.", citations: [{ type: "web_search_result_location", url: "https://law.cornell.edu/5891", title: "26 USC 5891", cited_text: "There is hereby imposed a tax equal to 40 percent" }] }], usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } } }) });
  assert.equal(an.citations[0].support, "There is hereby imposed a tax equal to 40 percent");
  assert.equal(an.answer.slice(an.citations[0].spanStart, an.citations[0].spanEnd), "a 40% excise tax applies.");
});

test("live: real-engine flow end to end (Perplexity API and pages faked at the network layer)", async () => {
  const { live, liveMarkdown } = await import("../src/live.mjs");
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.perplexity.ai/")) return new Response(JSON.stringify({ output: [
      { type: "search_results", results: [{ id: 1, url: "https://www.peachtreefinancial.com/cost?utm_source=x", title: "Cost" }, { id: 2, url: "https://www.reddit.com/r/personalfinance/comments/abc", title: "Sold mine" }] },
      { type: "message", content: [{ type: "output_text", text: "Court fees for selling a structured settlement usually range from $100 to $500 [1]. Peachtree Financial is a large buyer. One seller said the judge approved it after about 60 days [2]." }] }],
      usage: { input_tokens: 500, output_tokens: 120 } }), { status: 200 });
    const page = Object.keys(PAGES).find((k) => canonUrl(k) === canonUrl(u));
    if (page) return new Response(html(PAGES[page]), { status: 200, headers: { "content-type": "text/html" } });
    return new Response("nope", { status: 404 });
  };
  try {
    const r = await live({ prompts: ["How much does it cost to sell a structured settlement?"], brand: { name: "SettlementDecisions", domain: "settlementdecisions.com" }, competitors: [{ name: "Peachtree Financial", domain: "peachtreefinancial.com" }], env: { PERPLEXITY_API_KEY: "test" } });
    assert.equal(r.collected, 1);
    assert.deepEqual(r.answers[0].named, ["Peachtree Financial"]);
    assert.ok(r.sources.some((d) => d.domain === "reddit.com" && d.type === "forum"));
    assert.ok(r.winners.length && r.winners[0].passages[0].text.includes("$100"));
    assert.ok(r.opportunities.some((o) => o.domain === "reddit.com"));
    assert.match(liveMarkdown(r), /Where to get placed/);
    const none = await live({ prompts: ["q"], brand: { name: "x" }, env: {} });
    assert.match(none.error, /No answer-engine API key/);
  } finally { globalThis.fetch = real; }
});
