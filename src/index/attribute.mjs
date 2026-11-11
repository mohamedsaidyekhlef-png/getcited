// Attribution: for every sentence of an AI answer, find the passage on the cited pages
// that it was built from. This is what turns "competitor X was cited" into "this exact
// paragraph of X's page is what the engine used", the evidence for what to write.
//
// Retrieval is BM25 over the passages of the pages that answer cites (FTS5, Porter
// stemming), re-ranked by token containment so short sentences match the passage that
// actually contains their facts. Engine-provided support (Claude cited_text, Gemini
// grounding supports, OpenAI/Perplexity citation spans) is kept as the label, so
// accuracy is measured on real answers, not assumed.

import { sentences } from "../text.mjs";

const STOP = new Set("a an and are as at be by for from has have how i in is it its of on or that the this to was were what when which who why will with you your can do does".split(" "));
const toks = (s) => (String(s).toLowerCase().match(/[a-z0-9$%][a-z0-9$%.,]*[a-z0-9%]|[a-z0-9]/g) || []).map((w) => w.replace(/[.,]+$/, ""));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "");
const content = (s) => toks(s).filter((w) => !STOP.has(w)).map(stem);


/**
 * Attribute every sentence of the given observations (default: all not yet attributed).
 * Candidates are only the passages of pages that answer cited, so each answer is scored
 * against a few dozen passages: BM25 with IDF over that candidate set (what separates
 * one cited passage from another) blended with fact containment, where numbers count double.
 */
export function attribute(index, { observationIds, minScore = 0.34, k1 = 1.2, b = 0.75 } = {}) {
  const db = index.db;
  const obs = observationIds
    ? observationIds.map((id) => db.prepare("select id, answer from observations where id = ?").get(id)).filter(Boolean)
    : db.prepare("select o.id, o.answer from observations o where not exists (select 1 from attributions a where a.observation_id = o.id and a.method = 'bm25+contain')").all();
  const cites = db.prepare("select canon_url, span_start, span_end, support_text from citations where observation_id = ?");
  const pagePassages = db.prepare("select id, canon_url, heading, text from passages where canon_url = ? order by ord");
  const ins = db.prepare("insert or replace into attributions(observation_id, sentence_idx, sentence, canon_url, passage_id, score, method, label_url) values (?, ?, ?, ?, ?, ?, 'bm25+contain', ?)");
  const cache = new Map();
  const passagesOf = (url) => {
    if (cache.has(url)) return cache.get(url);
    const list = pagePassages.all(url).map((r) => {
      const t = content((r.heading || "") + " " + r.text);
      const tf = new Map();
      for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
      return { ...r, len: t.length, tf };
    });
    if (cache.size > 5000) cache.clear();
    cache.set(url, list);
    return list;
  };
  const stats = { observations: 0, sentences: 0, attributed: 0, ms: 0 };
  const t0 = performance.now();
  index.tx(() => {
    for (const o of obs) {
      const cs = cites.all(o.id);
      const urls = [...new Set(cs.map((c) => c.canon_url))];
      const cand = urls.flatMap(passagesOf);
      stats.observations++;
      if (!cand.length) continue;
      const N = cand.length;
      const avg = cand.reduce((x, p) => x + p.len, 0) / N || 1;
      const df = new Map();
      const idf = (w) => {
        if (!df.has(w)) { let n = 0; for (const p of cand) if (p.tf.has(w)) n++; df.set(w, n); }
        const n = df.get(w);
        return Math.log(1 + (N - n + 0.5) / (n + 0.5));
      };
      const clean = o.answer.replace(/\[\d+\]/g, "");
      let cursor = 0;
      sentences(clean).forEach((sent, i) => {
        stats.sentences++;
        const at = o.answer.indexOf(sent.slice(0, 40), cursor);
        const start = at >= 0 ? at : cursor;
        const end = start + sent.length;
        if (at >= 0) cursor = at + 1;
        const label = cs.find((c) => c.span_start != null && c.span_start < end && (c.span_end ?? c.span_start + 1) > start)?.canon_url
          ?? cs.find((c) => c.support_text && sent.length > 20 && (c.support_text.includes(sent.slice(0, 30)) || sent.includes(c.support_text.slice(0, 30))))?.canon_url ?? null;
        const q = [...new Set(content(sent))];
        let best = null, maxBm = 0;
        const scored = [];
        for (const p of cand) {
          let bm = 0, hit = 0, max = 0;
          for (const w of q) {
            const wt = /\d/.test(w) ? 2 : 1;
            max += wt;
            const f = p.tf.get(w);
            if (!f) continue;
            hit += wt;
            bm += idf(w) * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * p.len) / avg));
          }
          if (!hit) continue;
          if (bm > maxBm) maxBm = bm;
          scored.push({ p, bm, contain: max ? hit / max : 0 });
        }
        for (const x of scored) {
          const score = 0.6 * x.contain + 0.4 * (maxBm ? x.bm / maxBm : 0) * x.contain;
          if (!best || score > best.score) best = { ...x.p, score };
        }
        const ok = best && best.score >= minScore;
        if (ok) stats.attributed++;
        ins.run(o.id, i, sent, ok ? best.canon_url : null, ok ? best.id : null, best ? +best.score.toFixed(3) : 0, label);
      });
    }
  });
  stats.ms = Math.round(performance.now() - t0);
  return stats;
}

/** Accuracy against engine-provided labels: share of labelled sentences attributed to the labelled URL. */
export function evaluate(index) {
  const rows = index.all("select canon_url, label_url from attributions where label_url is not null and method = 'bm25+contain'");
  const n = rows.length;
  const hit = rows.filter((r) => r.canon_url === r.label_url).length;
  const covered = rows.filter((r) => r.canon_url).length;
  return { labelled: n, coverage: n ? covered / n : 0, precision: covered ? rows.filter((r) => r.canon_url && r.canon_url === r.label_url).length / covered : 0, accuracy: n ? hit / n : 0 };
}

/** The passages of one page that AI answers used most: what earned that page its citations. */
export function winningPassages(index, canonUrl, limit = 5) {
  return index.all(`select p.id, p.heading, p.text, count(*) uses, round(avg(a.score), 2) score,
      count(distinct o.engine) engines, count(distinct o.prompt_id) prompts
    from attributions a join passages p on p.id = a.passage_id join observations o on o.id = a.observation_id
    where a.canon_url = ? group by p.id order by uses desc, score desc limit ?`, canonUrl, limit);
}
