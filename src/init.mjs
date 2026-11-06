// `getcited init <url>`: write a starter getcited.yml with questions drawn
// from the page itself (question headings first, then its main topics).

import { get } from "./fetch.mjs";
import { readHtml } from "./html.mjs";

const q = (s) => JSON.stringify(s);

export async function initSpec(url, { competitors = [] } = {}) {
  const r = await get(url);
  const page = r.ok ? readHtml(r.body) : null;
  const questions = [];
  if (page) {
    for (const h of page.headings) if (/\?\s*$/.test(h.text) && h.text.length < 140) questions.push(h.text);
    const brand = page.meta["og:site_name"] || (page.title.split(/\s[|–—-]\s/).pop() || "").trim();
    const topic = (page.headings.find((h) => h.level === 1)?.text || page.title.split(/\s[|–—-]\s/)[0] || "").trim();
    if (questions.length < 3 && topic) questions.push(`What is ${topic.replace(/[.?!]+$/, "")}?`);
    for (const h of page.headings.filter((h) => h.level === 2 && !/\?$/.test(h.text) && h.text.split(" ").length <= 8)) {
      if (questions.length >= 5) break;
      questions.push(`${h.text.replace(/[.:!]+$/, "")}${brand && !h.text.includes(brand) ? ` (${brand})` : ""}?`.replace(/^(\w)/, (m) => m.toUpperCase()));
    }
  }
  if (!questions.length) questions.push("TODO: a question your customers ask an AI assistant");
  const lines = [
    "# getcited citation tests: https://github.com/mohamedsaidyekhlef-png/getcited",
    "# Run: npx github:mohamedsaidyekhlef-png/getcited test",
    `site: ${url}`,
    "",
    "# Pages you compete with for these answers (URLs, or saved .html snapshots for fully reproducible CI)",
    "competitors:",
    ...(competitors.length ? competitors.map((c) => `  - ${c}`) : ["  # - https://competitor.com/the-page-that-gets-cited"]),
    "",
    "# Fail if the static audit drops below this score",
    "min_score: 70",
    "",
    "# Questions customers ask. expect: cited | top1 | top3 | share>=30%   (prefix with \"live\" to check a real model with --model)",
    "questions:",
    ...questions.slice(0, 5).flatMap((x) => [`  - ask: ${q(x)}`, "    expect: top3"]),
    "",
    "# What's true about you, for `getcited truth` (needs --model)",
    "brand:",
    `  name: ${q((page && (page.meta["og:site_name"] || page.title.split(/\s[|–—-]\s/).pop())) || "TODO")}`,
    "  facts:",
    "    - TODO: one plain fact per line, e.g. founded in 2019 in Lyon",
    "truth:",
    "  min_accuracy: 0.8",
    "",
  ];
  return { yaml: lines.join("\n"), questions, loaded: Boolean(page), error: r.ok ? undefined : r.error || `HTTP ${r.status}` };
}
