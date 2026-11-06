// Split a page into the passages a retrieval-augmented answer engine indexes.
// Engines don't rank pages, they rank chunks: a few short paragraphs under one
// heading, with the heading kept as context. The page wins the citation only if
// one of its chunks makes it into the model's context window.

import { sentences, words } from "./text.mjs";
import { scoreSentence } from "./xray.mjs";

const TARGET = 140, MAX = 260;

export function passages(page, url) {
  const useMain = page.hasMain && page.blocks.some((b) => b.inMain);
  const blocks = page.blocks.filter((b) => (useMain ? b.inMain : true));
  const out = [];
  const path = [];
  let buf = [], n = 0;
  const heading = () => path.filter(Boolean).slice(-2).join(" › ") || page.title || "";
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(" ");
    const sents = sentences(text);
    const q = sents.length ? sents.reduce((a, s) => a + scoreSentence(s).score, 0) / sents.length / 100 : 0;
    out.push({ id: `${out.length}`, url, heading: heading(), text, words: words(text), quality: +q.toFixed(3), lead: out.filter((p) => p.heading === heading()).length === 0 });
    buf = []; n = 0;
  };
  for (const b of blocks) {
    const h = /^h([1-6])$/.exec(b.tag);
    if (h) {
      flush();
      const lvl = Number(h[1]);
      path.length = lvl;
      path[lvl - 1] = b.text;
      continue;
    }
    const w = words(b.text);
    if (w > MAX) {
      // One giant paragraph: split on sentence boundaries.
      flush();
      for (const s of sentences(b.text)) {
        buf.push(s); n += words(s);
        if (n >= TARGET) flush();
      }
      flush();
      continue;
    }
    if (n && n + w > MAX) flush();
    buf.push(b.text); n += w;
    if (n >= TARGET) flush();
  }
  flush();
  return out.filter((p) => p.words >= 6);
}
