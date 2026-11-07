// `simulate`: test a rewrite before you publish it. Fetches your page and the
// competing pages once, runs the Citation Arena on the page as it is, then again
// with your proposed passage placed at the top of the main content, and reports
// what changed: citation share, rank, and how quotable each new sentence is.

import { arena, loadSource } from "./arena.mjs";
import { sentences } from "./text.mjs";
import { scoreSentence } from "./xray.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Plain text (blank lines between paragraphs, "- " for list items) to HTML. */
export function passageHtml(heading, text) {
  const blocks = String(text || "").trim().split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const html = blocks.map((b) => {
    const lines = b.split("\n").map((l) => l.trim());
    if (lines.every((l) => /^[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${esc(lines.join(" "))}</p>`;
  }).join("");
  return `<section>${heading ? `<h2>${esc(heading)}</h2>` : ""}${html}</section>`;
}

/** Put the block at the top of <main> (or <article>, or <body>). */
export function inject(body, block) {
  for (const tag of ["main", "article", "body"]) {
    const m = new RegExp(`<${tag}\\b[^>]*>`, "i").exec(body);
    if (m) return body.slice(0, m.index + m[0].length) + block + body.slice(m.index + m[0].length);
  }
  return block + body;
}

export async function simulate({ question, mine, competitors = [], passage, heading, k = 5 }) {
  if (!passage?.trim()) throw new Error("simulate needs the passage you want to test");
  const sources = [{ url: mine, mine: true }, ...competitors.map((url) => ({ url }))];
  const loaded = await Promise.all(sources.map(loadSource));
  if (!loaded[0].ok) return { error: `Your page couldn't be loaded: ${loaded[0].error}` };
  const before = await arena(question, sources, { k, loaded });
  const edited = { ...loaded[0], body: inject(loaded[0].body, passageHtml(heading ?? question, passage)) };
  const after = await arena(question, sources, { k, loaded: [edited, ...loaded.slice(1)] });
  const prose = passage.split("\n").map((l) => (/^\s*[-*•]\s+/.test(l) ? l.replace(/^\s*[-*•]\s+/, "").replace(/([^.!?])\s*$/, "$1.") : l)).join("\n");
  const scored = sentences(prose).map((t) => ({ text: t, ...scoreSentence(t) }));
  return { question, mine, heading: heading ?? question, passage, before, after, sentences: scored };
}
