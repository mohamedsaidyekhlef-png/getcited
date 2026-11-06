import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHtml } from "../src/html.mjs";
import { passages } from "../src/passages.mjs";
import { xray, scoreSentence } from "../src/xray.mjs";
import { arena, fanout } from "../src/arena.mjs";
import { parseYaml } from "../src/yaml.mjs";
import { parseExpect, readSpec, runSpec, badge } from "../src/spec.mjs";
import { resolveModel } from "../src/llm.mjs";
import { truth } from "../src/truth.mjs";
import { serve } from "./server.mjs";
import { mockLlm } from "./mock-llm.mjs";

const run = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/getcited.mjs", import.meta.url));
const fx = (f) => fileURLToPath(new URL(`./fixtures/arena/${f}`, import.meta.url));
const page = (f) => readHtml(readFileSync(fx(f), "utf8"));
const Q = "How much does a structured settlement buyout cost?";
const rivals = [{ file: fx("settlewise.html"), url: "https://settlewise.example/" }, { file: fx("forum.html"), url: "https://forum.example/t/1" }];

test("query fan-out adds the sub-queries an AI search engine would run", () => {
  const f = fanout(Q);
  assert.equal(f[0].q, Q);
  assert.ok(f.some((x) => x.why === "pricing"));
  assert.ok(fanout("Best CRM for a 5-person agency?").some((x) => x.why === "comparison"));
  assert.ok(fanout("What is a structured settlement?").some((x) => x.why === "definition"));
});

test("pages are chunked into passages that keep their heading as context", () => {
  const ps = passages(page("settlewise.html"), "u");
  assert.ok(ps.length >= 4);
  const cost = ps.find((p) => p.text.startsWith("The cost is the gap"));
  assert.match(cost.heading, /What does a buyout cost\?/);
  assert.ok(ps.every((p) => p.words <= 300));
});

test("X-ray: marketing copy is dead weight, specific facts are quotable", () => {
  const bad = xray(page("mine.html"));
  const good = xray(page("settlewise.html"));
  assert.equal(bad.summary.quotable, 0);
  assert.ok(bad.summary.deadWordShare > 50, `dead ${bad.summary.deadWordShare}%`);
  assert.ok(good.summary.quotableShare >= 35, `quotable ${good.summary.quotableShare}%`);
  assert.equal(good.summary.firstQuotable, 0, "the good page answers in its first sentence");
  assert.ok(!good.sentences.some((s) => s.text === "$64,200"), "table cells aren't sentences");
  assert.equal(scoreSentence("Click here to get started today.").verdict, "dead");
  assert.match(scoreSentence("It is our mission to deliver a seamless, one-stop experience.").minus.join(), /doesn't stand alone.*fluff/);
  assert.equal(scoreSentence("That review catches quotes 10% to 15% below market.").minus.some((m) => /context/.test(m)), false, "'below market' is not a pointer");
});

test("arena: the specific page wins, the marketing page isn't cited, and you're told why", async () => {
  const r = await arena(Q, [{ file: fx("mine.html"), url: "https://cashnow.example/", mine: true }, ...rivals]);
  assert.equal(r.standings[0].label, "settlewise.example");
  assert.equal(r.gap.inContext, 0);
  assert.equal(r.gap.share, 0);
  assert.deepEqual(r.gap.missingTerms, ["structured", "buyout", "cost"]);
  assert.ok(r.gap.advice.some((a) => /specific numbers/.test(a)));
  const again = await arena(Q, [{ file: fx("mine.html"), url: "https://cashnow.example/", mine: true }, ...rivals]);
  assert.deepEqual(again, r, "offline mode is deterministic");
});

test("arena: rewriting the page to answer the question takes the citation", async () => {
  const r = await arena(Q, [{ file: fx("mine-fixed.html"), url: "https://cashnow.example/", mine: true }, ...rivals]);
  assert.equal(r.gap.rank, 1);
  assert.ok(r.gap.won);
  assert.ok(r.gap.share > 0.5);
});

test("getcited.yml: block maps, lists, inline lists, quotes, comments; clear errors", () => {
  const y = parseYaml(`site: https://a.test/ # me\nk: 4\nok: true\nlist: [cited, "share>=30%"]\nqs:\n  - ask: "Q: one?"\n    expect: top3\n  - plain item\nnested:\n  name: It's me\n  facts:\n    - a # c\n    - 'b # not a comment'\n`);
  assert.deepEqual(y, { site: "https://a.test/", k: 4, ok: true, list: ["cited", "share>=30%"], qs: [{ ask: "Q: one?", expect: "top3" }, "plain item"], nested: { name: "It's me", facts: ["a", "b # not a comment"] } });
  assert.throws(() => parseYaml("a:\n\tb: 1"), /line 2: use spaces/);
  assert.throws(() => parseYaml("a: |\n  text"), /isn't supported/);
  assert.deepEqual(parseExpect("live share >= 25%"), { live: true, kind: "share", op: ">=", min: 0.25, raw: "live share >= 25%" });
  assert.throws(() => parseExpect("wins big"), /unknown expectation/);
});

test("getcited test: fails CI before the fix, passes after, writes a badge and a job summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "getcited-"));
  const fail = await run("node", [bin, "test", fx("getcited.yml"), "--summary", join(dir, "sum.md")]).catch((e) => e);
  assert.equal(fail.code, 1);
  assert.match(fail.stdout, /4 failed/);
  assert.match(readFileSync(join(dir, "sum.md"), "utf8"), /citation test\(s\) failed/);
  const fixed = readFileSync(fx("getcited.yml"), "utf8").replace("site: mine.html", `site: ${fx("mine-fixed.html")}`).replace(/settlewise\.html|forum\.html/g, (m) => fx(m));
  writeFileSync(join(dir, "getcited.yml"), fixed);
  const ok = await run("node", [bin, "test", join(dir, "getcited.yml"), "--badge", join(dir, "badge.json")]);
  assert.match(ok.stdout, /all passed/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "badge.json"), "utf8")), { schemaVersion: 1, label: "AI citation tests", message: "4/4 passing", color: "brightgreen" });
});

test("live mode: a real (mock) model answers from shuffled passages; keys are sent, never reported", async () => {
  const m = await mockLlm();
  try {
    const llm = resolveModel("openai:test-model", { base: m.base, env: { OPENAI_API_KEY: "test-key" } });
    const r = await arena(Q, [{ file: fx("mine-fixed.html"), url: "https://cashnow.example/", mine: true }, ...rivals], { llm, samples: 3 });
    assert.equal(r.live.samples, 3);
    const me = r.live.share.find((s) => s.mine);
    assert.equal(me.citedIn, 3, "the page that states its discount rate is cited every time");
    const orders = m.calls.map((c) => c.body.messages.at(-1).content.match(/^\[1\] .{0,40}/m)[0]);
    assert.ok(new Set(orders).size > 1, "passage order is shuffled between samples");
    assert.ok(!JSON.stringify(r).includes("test-key"));
    assert.throws(() => resolveModel("openai:x", { env: {} }), /OPENAI_API_KEY is not set/);
  } finally { m.close(); }
});

test("truth: claims are checked against your facts and wrong ones become fixes (Anthropic wire format)", async () => {
  const m = await mockLlm();
  try {
    const llm = resolveModel("anthropic:test-model", { base: m.base, env: { ANTHROPIC_API_KEY: "test-key" } });
    const spec = await readSpec(fx("getcited.yml"));
    const t = await truth({ brand: spec.brand.name, facts: spec.brand.facts, llm });
    assert.equal(t.accuracy, 0.5);
    assert.equal(t.wrong, 1);
    assert.equal(t.claims[1].fact, "CashNow is based in Austin, Texas");
    assert.match(t.fixes[0], /Miami.*Austin/);
    assert.equal(m.calls[0].headers["anthropic-version"], "2023-06-01");
    const run2 = await runSpec(spec, { llm });
    assert.equal(run2.tests.find((x) => x.kind === "truth").status, "fail");
  } finally { m.close(); }
});

test("MCP server: initialize, list tools, call the X-ray", async () => {
  const s = await serve("good");
  const p = spawn("node", [bin, "mcp"]);
  try {
    const lines = [];
    let buf = "";
    const next = () => new Promise((res) => { const tick = () => { if (lines.length) return res(JSON.parse(lines.shift())); setTimeout(tick, 10); }; tick(); });
    p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    const send = (o) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    assert.equal((await next()).result.serverInfo.name, "getcited");
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list" });
    assert.deepEqual((await next()).result.tools.map((t) => t.name), ["getcited_audit", "getcited_xray", "getcited_arena", "getcited_truth"]);
    send({ id: 3, method: "tools/call", params: { name: "getcited_xray", arguments: { url: s.url } } });
    const out = await next();
    assert.equal(out.result.isError, false);
    assert.ok(JSON.parse(out.result.content[0].text).summary.quotable > 5);
  } finally { p.kill(); s.close(); }
});

test("init writes a starter getcited.yml from the page's own questions", async () => {
  const s = await serve("good");
  const dir = mkdtempSync(join(tmpdir(), "getcited-"));
  try {
    await run("node", [bin, "init", s.url, "-o", join(dir, "g.yml"), "--vs", "https://rival.example/"]);
    const spec = parseYaml(readFileSync(join(dir, "g.yml"), "utf8"));
    assert.equal(spec.site, s.url);
    assert.deepEqual(spec.competitors, ["https://rival.example/"]);
    assert.ok(spec.questions.some((q) => q.ask === "How long does a buyout take?"));
    assert.ok(badge({ passed: 0, failed: 0, questions: 0 }).message === "no tests");
  } finally { s.close(); }
});
