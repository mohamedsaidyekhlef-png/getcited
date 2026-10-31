import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../src/audit.mjs";
import { readHtml } from "../src/html.mjs";
import { isAllowed, parseRobots } from "../src/robots.mjs";
import { serve } from "./server.mjs";

const run = promisify(execFile);
const byId = (r, id) => [...r.site.checks, ...r.pages[0].checks].find((c) => c.id === id);

test("robots.txt: most specific group wins, longest rule wins, Allow wins ties", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: PerplexityBot\nAllow: /blog/\nDisallow: /blog/private\n\nUser-agent: a\nUser-agent: b\nDisallow: /x$\nAllow: /x$`);
  assert.equal(isAllowed(r, "GPTBot", "/").allowed, false);
  assert.equal(isAllowed(r, "PerplexityBot", "/blog/post").allowed, true);
  assert.equal(isAllowed(r, "PerplexityBot", "/blog/private/1").allowed, false);
  assert.equal(isAllowed(r, "PerplexityBot", "/other").allowed, true, "no matching rule in its own group means allowed");
  assert.equal(isAllowed(r, "b", "/x").allowed, true, "Allow wins a tie");
  assert.equal(isAllowed(parseRobots(""), "GPTBot", "/").allowed, true);
});

test("html reader extracts headings, paragraphs, JSON-LD, and survives broken markup", () => {
  const p = readHtml(`<html lang=fr><head><title>T &amp; co</title><meta name="description" content="d"><script type="application/ld+json">{"@type":"Thing"}</script><script type="application/ld+json">{bad json}</script></head><body><main><h1>Titre</h1><p>Un <b>paragraphe</b> &eacute;t&#233; ok<p>Deux</main><nav>skip me</nav></body>`);
  assert.equal(p.lang, "fr");
  assert.equal(p.title, "T & co");
  assert.equal(p.headings[0].text, "Titre");
  assert.equal(p.paragraphs[0].text, "Un paragraphe été ok");
  assert.equal(p.jsonld.length, 1);
  assert.equal(p.jsonldErrors.length, 1);
  assert.ok(!p.text.includes("skip me"), "nav text is excluded");
});

test("a well-built site scores high and its fixes contain only real facts", async () => {
  const s = await serve("good");
  try {
    const r = await audit(s.url);
    assert.ok(r.score.overall >= 90, `score ${r.score.overall}`);
    assert.equal(byId(r, "robots-ai").status, "pass");
    assert.equal(byId(r, "cdn-block").status, "pass");
    assert.equal(byId(r, "robots-training").status, "info", "blocking GPTBot is a choice, not a failure");
    assert.equal(byId(r, "structured-data").status, "pass");
    assert.equal(byId(r, "citations").status, "pass");
    assert.equal(byId(r, "freshness").status, "pass");
  } finally { s.close(); }
});

test("a broken site fails on every real problem, including CDN-level bot blocking", async () => {
  const s = await serve("bad");
  try {
    const r = await audit(s.url);
    assert.ok(r.score.overall < 30, `score ${r.score.overall}`);
    for (const id of ["robots-ai", "cdn-block", "server-rendered", "indexable", "structured-data"]) assert.equal(byId(r, id).status, "fail", id);
    assert.match(byId(r, "robots-ai").evidence, /OAI-SearchBot.*Claude-SearchBot.*PerplexityBot/);
    assert.match(byId(r, "cdn-block").evidence, /403/);
    assert.equal(r.priorities[0].category, "access", "access problems are ranked first");
  } finally { s.close(); }
});

test("CLI writes JSON, HTML, Markdown and fix files, and --min gates CI", async () => {
  const s = await serve("bad");
  const dir = mkdtempSync(join(tmpdir(), "getcited-"));
  try {
    const bin = fileURLToPath(new URL("../bin/getcited.mjs", import.meta.url));
    await run("node", [bin, s.url, "-q", "--json", join(dir, "r.json"), "--html", join(dir, "r.html"), "--md", join(dir, "r.md"), "--fix", join(dir, "fix")]);
    const json = JSON.parse(readFileSync(join(dir, "r.json"), "utf8"));
    assert.equal(json.tool, "getcited");
    assert.ok(readFileSync(join(dir, "r.html"), "utf8").includes("Fix these first"));
    for (const f of ["llms.txt", "schema.jsonld.html", "robots-ai-additions.txt", "FIXES.md"]) assert.ok(existsSync(join(dir, "fix", f)), f);
    const ld = readFileSync(join(dir, "fix", "schema.jsonld.html"), "utf8");
    assert.match(ld, /TODO: absolute URL of your logo/, "unknown facts are left as TODO, never invented");
    await assert.rejects(run("node", [bin, s.url, "-q", "--min", "50"]), (e) => e.code === 2);
  } finally { s.close(); }
});

test("local files can be audited before deploy", async () => {
  const r = await audit("", { file: fileURLToPath(new URL("./fixtures/good/index.html", import.meta.url)), url: "https://example.com/" });
  assert.equal(r.pages[0].checks.find((c) => c.id === "headings").status, "pass");
});
