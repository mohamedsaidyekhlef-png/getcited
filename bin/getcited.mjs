#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.mjs";
import { writeFixes } from "../src/fix.mjs";
import { toHtml, toJson, toMarkdown, toTerminal } from "../src/report.mjs";
import { arena } from "../src/arena.mjs";
import { get } from "../src/fetch.mjs";
import { readHtml } from "../src/html.mjs";
import { xray } from "../src/xray.mjs";
import { resolveModel } from "../src/llm.mjs";
import { badge, readSpec, runSpec } from "../src/spec.mjs";
import { truth } from "../src/truth.mjs";
import { initSpec } from "../src/init.mjs";
import { serveMcp } from "../src/mcp.mjs";
import { diffRuns, previousRun, saveRun } from "../src/history.mjs";
import { bench } from "../src/bench.mjs";
import { arenaHtml, arenaMarkdown, arenaTerminal, benchTerminal, diffMarkdown, diffTerminal, testMarkdown, testTerminal, truthTerminal, xrayHtml, xrayTerminal } from "../src/views.mjs";

const VERSION = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;
const HELP = `getcited ${VERSION}: unit tests for AI search. Find out who ChatGPT, Perplexity and
Google AI Overviews would cite instead of you, why, and how to take the citation.

Commands
  getcited <url>                          audit: can AI engines reach, read, quote and trust the page?
  getcited xray <url>                     sentence-by-sentence: what an AI would quote, what's dead weight
  getcited arena "<question>" <your-url> <competitor-url>...
                                          who gets cited for this question, and what your page is missing
  getcited test [getcited.yml]            run your citation tests; exits 1 on failure (for CI).
                                          Every run is saved and compared with the last: what regressed, and why
  getcited diff <old.json> <new.json>     compare two saved runs
  getcited bench <bench.yml> [--observe perplexity:sonar]
                                          measure how well the arena predicts a real engine's citations
  getcited init <url> [--vs <url>...]     write a starter getcited.yml from your page
  getcited truth "<brand>" --fact "..."   what a model believes about you, checked against your facts
  getcited mcp                            run as an MCP server for Claude, Cursor, Codex, VS Code…

Audit options
  --pages <n>      also audit n linked pages      --fix <dir>     draft fixes (llms.txt, JSON-LD, robots)
  --file <html>    audit a local build (with --url <real url>)
  --min <score>    exit 2 below this score        --no-bots       skip the CDN check with AI-bot user agents

Arena / test / truth options
  --k <n>          passages in the engine's context (default 5)
  --model <p:m>    add live answers from a real model: openai:<model>, anthropic:<model>, gemini:<model>,
                   openrouter:<model>, groq:<model>, mistral:<model>, deepseek:<model>, ollama:<model>
                   keys come from OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, ... (never stored)
  --base-url <u>   any OpenAI-compatible endpoint   --samples <n>   live answers per question (default 3)
  --judge <p:m>    separate model to fact-check truth claims
  --embed <p:m>    hybrid retrieval: add embeddings (openai:text-embedding-3-small, ollama:nomic-embed-text…)
  --history <dir>  where test runs are saved (default .getcited/history)   --no-history
  --fail-on-regression   exit 1 when anything regressed since the last run

Output (any command)
  --html <file>    visual report    --md <file>    Markdown    --json [file]   JSON (stdout if no file)
  --summary <file> append Markdown (e.g. $GITHUB_STEP_SUMMARY)   --badge <file>  shields.io endpoint JSON
  -q, --quiet      no terminal output     -v, --version     -h, --help`;

function die(msg, code = 1) { console.error(`getcited: ${msg}`); process.exit(code); }

function parse(argv) {
  const a = { pages: 1, probeBots: true, quiet: false, pos: [], vs: [], facts: [] };
  const COMMANDS = ["audit", "xray", "arena", "test", "init", "truth", "mcp", "diff", "bench"];
  if (COMMANDS.includes(argv[0])) a.cmd = argv.shift();
  else a.cmd = "audit";
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) die(`${k} needs a value`); return v; };
    switch (k) {
      case "-h": case "--help": console.log(HELP); process.exit(0);
      case "-v": case "--version": console.log(VERSION); process.exit(0);
      case "--pages": a.pages = Math.min(50, Math.max(1, parseInt(val(), 10) || 1)); break;
      case "--file": a.file = val(); break;
      case "--url": a.url = val(); break;
      case "--html": a.html = val(); break;
      case "--md": a.md = val(); break;
      case "--summary": a.summary = val(); break;
      case "--badge": a.badge = val(); break;
      case "--json": a.json = argv[i + 1] === "-" || (argv[i + 1] && !argv[i + 1].startsWith("-")) ? argv[++i] : "-"; break;
      case "--fix": a.fix = val(); break;
      case "--min": a.min = Number(val()); break;
      case "--no-bots": a.probeBots = false; break;
      case "--k": a.k = Math.max(1, Math.min(20, parseInt(val(), 10) || 5)); break;
      case "--model": a.model = val(); break;
      case "--judge": a.judge = val(); break;
      case "--embed": a.embed = val(); break;
      case "--observe": a.observe = val(); break;
      case "--history": a.history = val(); break;
      case "--no-history": a.history = false; break;
      case "--fail-on-regression": a.failOnRegression = true; break;
      case "--base-url": a.baseUrl = val(); break;
      case "--samples": a.samples = Math.max(1, Math.min(10, parseInt(val(), 10) || 3)); break;
      case "--vs": a.vs.push(val()); break;
      case "--fact": a.facts.push(val()); break;
      case "--facts": a.factsFile = val(); break;
      case "--site": a.site = val(); break;
      case "-o": case "--out": a.out = val(); break;
      case "--force": a.force = true; break;
      case "-q": case "--quiet": a.quiet = true; break;
      default: if (k.startsWith("-") && k !== "-") die(`Unknown option ${k}. Run getcited --help.`); a.pos.push(k);
    }
  }
  return a;
}

const a = parse(process.argv.slice(2));
const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const toStdout = a.json === "-";
const say = (s) => { if (!a.quiet && !toStdout) process.stdout.write(s); };
const write = (file, data) => { mkdirSync(dirname(resolve(file)), { recursive: true }); writeFileSync(file, data); };
const json = (obj) => { if (toStdout) process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); else if (a.json) write(a.json, JSON.stringify(obj, null, 2)); };
const model = (spec) => { try { return resolveModel(spec, { base: a.baseUrl }); } catch (e) { die(e.message); } };
const asSource = (ref, mine) => (existsSync(ref) && !/^https?:/i.test(ref) ? { file: ref, url: a.url && mine ? a.url : ref, mine } : { url: /^https?:\/\//i.test(ref) ? ref : "https://" + ref, mine });

switch (a.cmd) {
  case "audit": {
    const target = a.url || a.pos[0];
    if (!target && !a.file) { console.log(HELP); process.exit(1); }
    const report = await audit(target || "", { pages: a.pages, file: a.file, url: a.url, probeBots: a.probeBots });
    if (report.error) die(`couldn't load ${report.url}: ${report.error}`);
    if (toStdout) process.stdout.write(toJson(report) + "\n");
    else { if (a.json) write(a.json, toJson(report)); say(toTerminal(report, color)); }
    if (a.md) write(a.md, toMarkdown(report));
    if (a.summary) appendFileSync(a.summary, toMarkdown(report));
    if (a.html) write(a.html, toHtml(report));
    if (a.badge) write(a.badge, JSON.stringify({ schemaVersion: 1, label: "AI citation readiness", message: `${report.score.overall}/100`, color: report.score.overall >= 75 ? "brightgreen" : report.score.overall >= 50 ? "yellow" : "red" }));
    if (a.fix) {
      const files = await writeFixes(report, a.fix);
      say(`Draft fixes in ${a.fix}/:\n` + files.map((f) => `  ${f.file}  ${f.note}`).join("\n") + "\n");
    }
    if (a.min !== undefined && report.score.overall < a.min) die(`score ${report.score.overall} is below --min ${a.min}`, 2);
    break;
  }
  case "xray": {
    const target = a.pos[0];
    if (!target && !a.file) die('usage: getcited xray <url>  (or --file page.html)');
    let body, url;
    if (a.file) { body = readFileSync(a.file, "utf8"); url = a.url || a.file; }
    else {
      const r = await get(/^https?:\/\//i.test(target) ? target : "https://" + target);
      if (!r.ok) die(`couldn't load ${target}: ${r.error || `HTTP ${r.status}`}`);
      body = r.body; url = r.url;
    }
    const x = xray(readHtml(body));
    if (!x.sentences.length) die(`no readable sentences in ${url}. If it renders with JavaScript, AI crawlers see it empty too.`);
    json({ tool: "getcited", url, summary: x.summary, best: x.best, worst: x.worst, sentences: x.sentences });
    say(xrayTerminal(url, x, color));
    if (a.html) write(a.html, xrayHtml(url, x));
    if (a.md) write(a.md, `# Citation X-ray: ${url}\n\n${x.summary.quotableShare}% of ${x.summary.sentences} sentences are quotable.\n\n## Rewrite these\n\n${x.worst.map((s) => `- "${s.text}" — ${s.minus.join("; ")}`).join("\n")}\n`);
    break;
  }
  case "arena": {
    const [question, ...refs] = a.pos;
    if (!question || (!refs.length && !a.file)) die('usage: getcited arena "<question>" <your-url> <competitor-url>...');
    const sources = [...(a.file ? [{ file: a.file, url: a.url || a.file, mine: true }] : []), ...refs.map((r, i) => asSource(r, !a.file && i === 0)), ...a.vs.map((r) => asSource(r, false))];
    const r = await arena(question, sources, { k: a.k, llm: a.model ? model(a.model) : undefined, embed: a.embed ? model(a.embed) : undefined, samples: a.samples });
    json(r);
    say(arenaTerminal(r, color));
    if (a.html) write(a.html, arenaHtml(r));
    if (a.md) write(a.md, arenaMarkdown(r) + "\n");
    if (a.summary) appendFileSync(a.summary, arenaMarkdown(r) + "\n");
    if (r.standings.every((s) => !s.ok)) process.exit(1);
    break;
  }
  case "test": {
    const path = a.pos[0] || (existsSync("getcited.yml") ? "getcited.yml" : existsSync("getcited.yaml") ? "getcited.yaml" : existsSync("getcited.json") ? "getcited.json" : null);
    if (!path) die("no getcited.yml here. Create one with: getcited init https://yoursite.com");
    let spec;
    try { spec = await readSpec(path); } catch (e) { die(e.message); }
    const llm = a.model ? model(a.model) : spec.model && process.env.GETCITED_LIVE !== "0" ? model(spec.model) : undefined;
    const run = await runSpec(spec, { llm, judge: a.judge ? model(a.judge) : undefined, embed: a.embed ? model(a.embed) : spec.embed ? model(spec.embed) : undefined });
    const histDir = a.history === false ? null : a.history || spec.history || ".getcited/history";
    const prev = histDir ? previousRun(histDir) : null;
    if (histDir) run.savedTo = saveRun(histDir, run);
    if (prev) run.diff = diffRuns(prev.run, (await import("../src/history.mjs")).snapshot(run));
    json(run);
    say(testTerminal(run, color));
    if (run.diff) say(diffTerminal(run.diff, color));
    const md = testMarkdown(run) + (run.diff ? "\n" + diffMarkdown(run.diff) : "");
    if (a.md) write(a.md, md);
    if (a.summary) appendFileSync(a.summary, md);
    if (a.badge) write(a.badge, JSON.stringify(badge(run)));
    if (a.html) write(a.html, run.results.map((r) => arenaHtml(r)).join("\n"));
    if (run.failed || (a.failOnRegression && run.diff?.regressions)) process.exit(1);
    break;
  }
  case "diff": {
    const [oldF, newF] = a.pos;
    if (!oldF || !newF) die("usage: getcited diff <old-run.json> <new-run.json>  (runs are saved in .getcited/history)");
    const load = (f) => { const j = JSON.parse(readFileSync(f, "utf8")); return j.kind === "run" ? j : null; };
    const o = load(oldF), n = load(newF);
    if (!o || !n) die("both files must be runs saved by getcited test");
    const d = diffRuns(o, n);
    json(d);
    say("\n" + diffTerminal(d, color));
    if (a.md) write(a.md, diffMarkdown(d));
    if (a.failOnRegression && d.regressions) process.exit(1);
    break;
  }
  case "bench": {
    const path = a.pos[0];
    if (!path) die("usage: getcited bench <bench.yml> [--observe perplexity:sonar] [--embed provider:model]");
    let spec;
    try { spec = await readSpec(path).catch(async () => ({ ...(await import("../src/yaml.mjs")).parseYaml(readFileSync(path, "utf8")) })); } catch (e) { die(e.message); }
    const b = await bench(spec, { observe: a.observe ? model(a.observe) : undefined, embed: a.embed ? model(a.embed) : undefined });
    json(b);
    say(benchTerminal(b, color));
    if (a.md) write(a.md, `# getcited bench\n\nTop-1 accuracy ${b.top1 ?? "–"} (baseline ${b.baselineTop1 ?? "–"}), precision@n ${b.precisionAtN ?? "–"} over ${b.scored} questions vs ${b.engine}.\n`);
    break;
  }
  case "init": {
    const target = a.pos[0];
    if (!target) die("usage: getcited init <url> [--vs <competitor-url>...]");
    const out = a.out || "getcited.yml";
    if (existsSync(out) && !a.force) die(`${out} already exists (use --force to overwrite)`);
    const s = await initSpec(/^https?:\/\//i.test(target) ? target : "https://" + target, { competitors: a.vs });
    write(out, s.yaml);
    say(`Wrote ${out} with ${s.questions.length} question(s)${s.loaded ? " from your page" : ` (couldn't load the page: ${s.error})`}.\nEdit the questions and competitors, then run: getcited test\n`);
    break;
  }
  case "truth": {
    let brand = a.pos[0], facts = [...a.facts], site = a.site;
    if (a.factsFile) {
      if (/\.ya?ml$|\.json$/i.test(a.factsFile)) { const s = await readSpec(a.factsFile).catch((e) => die(e.message)); brand ||= s.brand?.name; site ||= s.site; facts.push(...[].concat(s.brand?.facts || [])); }
      else facts.push(...readFileSync(a.factsFile, "utf8").split(/\r?\n/).map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean));
    }
    facts = facts.filter((f) => !/^TODO\b/i.test(f));
    if (!brand || !facts.length) die('usage: getcited truth "<brand>" --fact "founded in 2019" --fact "based in Lyon" --model openai:<model>');
    if (!a.model) die("truth needs a model, e.g. --model openai:gpt-4.1-mini or --model ollama:llama3.1");
    try {
      const t = await truth({ brand, site, facts, llm: model(a.model), judge: a.judge ? model(a.judge) : undefined });
      json(t);
      say(truthTerminal(t, color));
    } catch (e) { die(e.message); }
    break;
  }
  case "mcp":
    serveMcp({ version: VERSION });
    break;
}
