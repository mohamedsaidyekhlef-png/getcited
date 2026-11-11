// Open Authority: domain authority and referring domains for the whole web, computed
// from Common Crawl's open domain-level web graph (118M domains, 2.8B links per release).
// Streams the files from stdin (curl | pigz -dc | node …) so nothing large touches disk.
//
//   node scripts/open-authority.mjs ranks    <top N>  < domain-ranks.txt      → work/top.tsv
//   node scripts/open-authority.mjs vertices          < domain-vertices.txt   → work/idmap.bin, work/targets.json
//   node scripts/open-authority.mjs edges             < domain-edges.txt      → work/indeg.bin, work/referrers.bin
//   node scripts/open-authority.mjs names             < domain-vertices.txt   → work/referrers.json
//   node scripts/open-authority.mjs shards   <out dir> <release id>           → out/<00..ff>.tsv, out/meta.json, out/targets.json
//
// Open Authority (OA, 0–100) is a log-rank transform of harmonic centrality, the measure
// Common Crawl computes for every domain:  OA = 100 · (1 − (ln rank / ln N)²).
// Rank 1 → 100, rank 100 → ~94, rank 10k → ~75, rank 1M → ~45, the median domain → ~3.

import { createWriteStream, readFileSync, writeFileSync, mkdirSync, existsSync, openSync, writeSync, closeSync, readSync } from "node:fs";
import { createHash } from "node:crypto";

/** Typed view of a file's bytes (Buffer may be a slice of a shared pool: copy just our range). */
const readTyped = (file, T) => { const b = readFileSync(file); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const WORK = process.env.OA_WORK || "work";
mkdirSync(WORK, { recursive: true });
const unrev = (r) => r.split(".").reverse().join(".");
const rev = (d) => d.split(".").reverse().join(".");
const TARGETS = (process.env.OA_TARGETS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Fast line reader over stdin: calls fn(line) for each line, as a latin1 string. */
async function lines(fn) {
  let rest = "";
  let n = 0;
  for await (const chunk of process.stdin) {
    const s = rest + chunk.toString("latin1");
    let start = 0, i;
    while ((i = s.indexOf("\n", start)) >= 0) { fn(s.slice(start, i)); start = i + 1; n++; }
    rest = s.slice(start);
  }
  if (rest) { fn(rest); n++; }
  return n;
}

/** Faster path for the edges file: parse "from\tto\n" integers straight from bytes. */
async function edgePairs(fn) {
  let a = 0, b = 0, inB = false, any = false, n = 0;
  for await (const chunk of process.stdin) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (c >= 48 && c <= 57) { if (inB) b = b * 10 + (c - 48); else a = a * 10 + (c - 48); any = true; }
      else if (c === 9) inB = true;
      else if (c === 10) { if (any && inB) { fn(a, b); n++; } a = 0; b = 0; inB = false; any = false; }
    }
  }
  if (any && inB) { fn(a, b); n++; }
  return n;
}

const cmd = process.argv[2];
const t0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

if (cmd === "ranks") {
  // Columns: #harmonicc_pos #harmonicc_val #pr_pos #pr_val #host_rev #n_hosts
  const TOP = Number(process.argv[3] || 5_000_000);
  const out = createWriteStream(`${WORK}/top.tsv`);
  let kept = 0, total = 0;
  await lines((l) => {
    if (l.charCodeAt(0) === 35) return;
    total++;
    if (kept >= TOP) return;
    const f = l.split("\t");
    out.write(`${f[4]}\t${f[0]}\t${f[1]}\t${f[2]}\t${f[5] || ""}\n`);
    kept++;
  });
  await new Promise((r) => out.end(r));
  writeFileSync(`${WORK}/ranks.json`, JSON.stringify({ total, kept }));
  log(`ranks: ${total.toLocaleString()} domains, kept top ${kept.toLocaleString()}`);
}

if (cmd === "vertices") {
  // Columns: id, reversed domain, number of hosts. Map graph ids to positions in top.tsv.
  const top = new Map();
  readFileSync(`${WORK}/top.tsv`, "latin1").split("\n").forEach((l, i) => { if (l) top.set(l.slice(0, l.indexOf("\t")), i); });
  const { total } = JSON.parse(readFileSync(`${WORK}/ranks.json`, "utf8"));
  const idmap = new Int32Array(total + 1024).fill(-1);
  const targets = {};
  const want = new Set(TARGETS.map(rev));
  let max = 0;
  await lines((l) => {
    const t1 = l.indexOf("\t"), t2 = l.indexOf("\t", t1 + 1);
    const id = +l.slice(0, t1);
    const name = l.slice(t1 + 1, t2 < 0 ? undefined : t2);
    if (id > max) max = id;
    const pos = top.get(name);
    if (pos !== undefined && id < idmap.length) idmap[id] = pos;
    if (want.has(name)) targets[unrev(name)] = id;
  });
  writeFileSync(`${WORK}/idmap.bin`, Buffer.from(idmap.buffer, 0, (max + 1) * 4));
  writeFileSync(`${WORK}/targets.json`, JSON.stringify(targets));
  log(`vertices: max id ${max.toLocaleString()}, ${top.size.toLocaleString()} top domains mapped, targets ${JSON.stringify(targets)}`);
}

if (cmd === "edges") {
  // Columns: from id, to id (domain-level, deduplicated). In-degree = referring domains.
  const idmap = readTyped(`${WORK}/idmap.bin`, Int32Array);
  const N = readFileSync(`${WORK}/top.tsv`, "latin1").split("\n").filter(Boolean).length;
  const indeg = new Uint32Array(N);
  const targets = JSON.parse(readFileSync(`${WORK}/targets.json`, "utf8"));
  const tset = new Map(Object.entries(targets).map(([d, id]) => [id, d]));
  const refs = {};
  for (const d of Object.keys(targets)) refs[d] = [];
  const n = await edgePairs((from, to) => {
    const p = idmap[to];
    if (p >= 0) indeg[p]++;
    if (tset.size && tset.has(to)) { const r = refs[tset.get(to)]; if (r.length < 200000) r.push(from); }
  });
  writeFileSync(`${WORK}/indeg.bin`, Buffer.from(indeg.buffer));
  writeFileSync(`${WORK}/referrers.raw.json`, JSON.stringify(refs));
  log(`edges: ${n.toLocaleString()} links; referrers ${Object.entries(refs).map(([d, r]) => `${d}=${r.length}`).join(", ")}`);
}

if (cmd === "names") {
  // Resolve referrer ids to domain names.
  const refs = JSON.parse(readFileSync(`${WORK}/referrers.raw.json`, "utf8"));
  const want = new Set(Object.values(refs).flat());
  const names = new Map();
  await lines((l) => {
    const t1 = l.indexOf("\t");
    const id = +l.slice(0, t1);
    if (!want.has(id)) return;
    const t2 = l.indexOf("\t", t1 + 1);
    names.set(id, unrev(l.slice(t1 + 1, t2 < 0 ? undefined : t2)));
  });
  const out = Object.fromEntries(Object.entries(refs).map(([d, ids]) => [d, ids.map((i) => names.get(i)).filter(Boolean)]));
  writeFileSync(`${WORK}/referrers.json`, JSON.stringify(out));
  log(`names: resolved ${names.size.toLocaleString()} referring domains`);
}

if (cmd === "shards") {
  const OUT = process.argv[3] || "out";
  const RELEASE = process.argv[4] || "unknown";
  mkdirSync(OUT, { recursive: true });
  const { total } = JSON.parse(readFileSync(`${WORK}/ranks.json`, "utf8"));
  const indeg = readTyped(`${WORK}/indeg.bin`, Uint32Array);
  const lnN = Math.log(total);
  const oa = (pos) => Math.max(0, Math.round(100 * (1 - (Math.log(pos) / lnN) ** 2)));
  const shards = Array.from({ length: 256 }, () => []);
  const byName = new Map();
  readFileSync(`${WORK}/top.tsv`, "latin1").split("\n").forEach((l, i) => {
    if (!l) return;
    const [r, hcPos, hcVal, prPos, hosts] = l.split("\t");
    const d = unrev(r);
    const row = [d, oa(+hcPos), +hcPos, +prPos, indeg[i], +hosts || 0];
    byName.set(d, row);
    shards[parseInt(createHash("sha1").update(d).digest("hex").slice(0, 2), 16)].push(row.join("\t"));
  });
  shards.forEach((rows, i) => writeFileSync(`${OUT}/${i.toString(16).padStart(2, "0")}.tsv`, rows.length ? rows.join("\n") + "\n" : ""));
  const meta = { release: RELEASE, builtAt: new Date().toISOString(), domainsInGraph: total, domainsPublished: byName.size, columns: ["domain", "oa", "harmonic_rank", "pagerank_rank", "referring_domains", "hosts"], formula: "OA = round(100 * (1 - (ln(harmonic_rank) / ln(domainsInGraph))^2))", source: "Common Crawl host- and domain-level web graph, https://commoncrawl.org/web-graphs" };
  writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2));
  if (existsSync(`${WORK}/referrers.json`)) {
    const refs = JSON.parse(readFileSync(`${WORK}/referrers.json`, "utf8"));
    const t = {};
    for (const [d, list] of Object.entries(refs)) {
      const scored = list.map((x) => { const r = byName.get(x); return { domain: x, oa: r ? r[1] : 0, harmonicRank: r ? r[2] : null }; }).sort((a, b) => b.oa - a.oa);
      t[d] = { self: byName.get(d) || null, referringDomains: list.length, top: scored.slice(0, 500), byOA: [90, 70, 50, 30, 10, 0].map((min, i, arr) => ({ min, max: i ? arr[i - 1] - 1 : 100, count: scored.filter((s) => s.oa >= min && (i === 0 || s.oa < arr[i - 1])).length })) };
    }
    writeFileSync(`${OUT}/targets.json`, JSON.stringify(t, null, 1));
  }
  log(`shards: ${byName.size.toLocaleString()} domains in 256 shards`);
}
