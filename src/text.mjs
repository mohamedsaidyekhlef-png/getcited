// Text utilities shared by the retrieval simulator and the sentence X-ray.
// Deterministic and dependency-free on purpose: the same input always gives
// the same output, so results can be asserted in CI.

const STOP = new Set(`a about above after again against all am an and any are as at be because been before being below between both but by can
could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it
its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such
than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which
while who whom why will with would you your yours yourself yourselves get got also may might must shall us via per vs versus using use used much many
le la les un une des du de et ou en dans pour par sur avec est sont que qui ce cette ces au aux il elle ils elles nous vous se sa son ses leur
el los las del y o en para por con es son que un una`.split(/\s+/));

/** Light, language-tolerant stemmer: enough to match "prices"~"price", "running"~"run". */
export function stem(word) {
  const w = stemSuffix(word);
  return w.length > 4 && w.endsWith("e") ? w.slice(0, -1) : w; // "price" and "pricing" -> "pric"
}

function stemSuffix(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  for (const suf of ["ings", "ing", "edly", "ed", "es", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3 && !(suf === "s" && /(ss|us|is)$/.test(w))) {
      let base = w.slice(0, -suf.length);
      if ((suf === "es") && !/(ch|sh|x|z|ss|o)$/.test(base)) base = w.slice(0, -1); // "prices" -> "price"
      if (/(ing|ed)/.test(suf) && /([b-df-hj-np-tv-z])\1$/.test(base)) base = base.slice(0, -1); // "running" -> "run"
      return base;
    }
  }
  return w;
}

/** Lowercase word tokens with stopwords removed and light stemming. */
export function terms(text) {
  return termMap(text).map((x) => x.t);
}

/** Like terms(), but keeps the original word next to each stem (for display). */
export function termMap(text) {
  const out = [];
  for (const raw of String(text).toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []) {
    const w = raw.replace(/['’.-]+$/g, "").replace(/['’]s$/, "");
    if (!w || STOP.has(w)) continue;
    out.push({ t: stem(w), raw: w });
  }
  return out;
}

/** Split text into sentences without breaking on "e.g.", "3.5", "Dr." or URLs. */
export function sentences(text) {
  const protectedText = String(text)
    .replace(/\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Inc|Ltd|Co|St|No|approx|fig)\./gi, "$1\u0000")
    .replace(/(\d)\.(\d)/g, "$1\u0000$2");
  return protectedText
    .split(/(?<=[.!?…])\s+(?=["“(\[]?[\p{Lu}\p{N}])/u)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

export const words = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

/** Okapi BM25 over a fixed set of documents (each an array of terms). */
export function bm25(docs, { k1 = 1.2, b = 0.75 } = {}) {
  const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map();
  const tfs = docs.map((d) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  return {
    idf,
    score(query, i) {
      const tf = tfs[i], len = docs[i].length;
      let s = 0;
      for (const t of new Set(query)) {
        const f = tf.get(t);
        if (!f) continue;
        s += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avg)));
      }
      return s;
    },
  };
}

/** Small seeded PRNG (mulberry32) so "random" shuffles are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
