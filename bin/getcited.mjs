#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.mjs";
import { writeFixes } from "../src/fix.mjs";
import { toHtml, toJson, toMarkdown, toTerminal } from "../src/report.mjs";

const VERSION = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;
const HELP = `getcited ${VERSION}
Why doesn't ChatGPT cite your site? Audit any page for AI-citation readiness.

Usage
  getcited <url>                 audit one page (and its site's robots.txt, llms.txt, sitemap, CDN)
  getcited <url> --pages 10      also audit up to 10 linked pages on the same site
  getcited --file page.html      audit a local HTML file (e.g. your build output)

Options
  --html <file>      write a visual report        --md <file>    write a Markdown report
  --json [file]      write JSON (stdout if no file)
  --fix <dir>        write draft fixes: llms.txt, JSON-LD, robots additions, FIXES.md
  --min <score>      exit 2 if the score is below this (for CI)
  --no-bots          skip the CDN check with real AI-crawler user agents
  -q, --quiet        no terminal report        -v, --version    -h, --help`;

function parse(argv) {
  const a = { pages: 1, probeBots: true, quiet: false };
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
      case "--json": a.json = argv[i + 1] === "-" || (argv[i + 1] && !argv[i + 1].startsWith("-")) ? argv[++i] : "-"; break;
      case "--fix": a.fix = val(); break;
      case "--min": a.min = Number(val()); break;
      case "--no-bots": a.probeBots = false; break;
      case "-q": case "--quiet": a.quiet = true; break;
      default: if (k.startsWith("-")) die(`Unknown option ${k}. Run getcited --help.`); a.target = k;
    }
  }
  if (!a.target && !a.file) { console.log(HELP); process.exit(1); }
  return a;
}

function die(msg) { console.error(`getcited: ${msg}`); process.exit(1); }

const a = parse(process.argv.slice(2));
const report = await audit(a.url || a.target || "", { pages: a.pages, file: a.file, url: a.url, probeBots: a.probeBots });
if (report.error) die(`couldn't load ${report.url}: ${report.error}`);

if (a.json === "-") process.stdout.write(toJson(report) + "\n");
else {
  if (a.json) writeFileSync(a.json, toJson(report));
  if (!a.quiet) process.stdout.write(toTerminal(report, Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
}
if (a.md) writeFileSync(a.md, toMarkdown(report));
if (a.html) writeFileSync(a.html, toHtml(report));
if (a.fix) {
  const files = await writeFixes(report, a.fix);
  if (!a.quiet && a.json !== "-") console.log(`Draft fixes in ${a.fix}/:\n` + files.map((f) => `  ${f.file}  ${f.note}`).join("\n") + "\n");
}
if (a.min !== undefined && report.score.overall < a.min) {
  console.error(`getcited: score ${report.score.overall} is below --min ${a.min}`);
  process.exit(2);
}
