// Site Explorer over Open Authority: domain authority (OA 0–100), harmonic-centrality and
// PageRank ranks, and referring domains, computed from Common Crawl's open web graph by
// scripts/open-authority.mjs and published as GitHub Release shards. Lookups fetch one
// small shard per domain and cache it.

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const OA_RELEASE = process.env.GETCITED_OA_RELEASE || "cc-main-2026-may-jun-jul";
const BASE = () => process.env.GETCITED_OA_BASE || `https://github.com/mohamedsaidyekhlef-png/getcited/releases/download/oa-${OA_RELEASE}`;
const cache = new Map();

export const cleanDomain = (d) => String(d || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^(www\d?|m)\./, "");
const shardOf = (d) => createHash("sha1").update(d).digest("hex").slice(0, 2);

async function fetchBin(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "getcited-open-authority" } });
  if (!res.ok) throw new Error(`Open Authority data unavailable (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function shard(id) {
  if (cache.has(id)) return cache.get(id);
  const p = fetchBin(`${BASE()}/${id}.tsv.gz`).catch((e) => { if (/HTTP 404/.test(e.message)) return null; throw e; }).then((buf) => {
    const map = new Map();
    if (!buf) return map;
    for (const l of gunzipSync(buf).toString("utf8").split("\n")) {
      if (!l) continue;
      const [domain, oa, hc, pr, refs, hosts] = l.split("\t");
      map.set(domain, { domain, oa: +oa, harmonicRank: +hc, pagerankRank: +pr, referringDomains: +refs, hosts: +hosts });
    }
    return map;
  });
  cache.set(id, p);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  p.catch(() => cache.delete(id));
  return p;
}

/** Authority rows for domains; subdomains fall back to their registrable parent. */
export async function lookup(domains) {
  const out = [];
  for (const raw of domains) {
    const d = cleanDomain(raw);
    let row = (await shard(shardOf(d))).get(d);
    if (!row && d.split(".").length > 2) {
      const parent = d.split(".").slice(-2).join(".");
      const p = (await shard(shardOf(parent))).get(parent);
      if (p) row = { ...p, via: parent };
    }
    out.push(row ? { ...row, query: d } : { query: d, domain: d, oa: null, note: "not in the top published domains (OA below ~25, or not linked from the crawled web)" });
  }
  return out;
}

let metaP, targetsP;
export const meta = () => (metaP ||= fetchBin(`${BASE()}/meta.json`).then((b) => JSON.parse(b.toString("utf8"))).catch((e) => { metaP = null; throw e; }));
export const targets = () => (targetsP ||= fetchBin(`${BASE()}/targets.json`).then((b) => JSON.parse(b.toString("utf8"))).catch(() => ({})));

/** Site Explorer: one domain against its competitors, with referring domains when tracked. */
export async function siteExplorer(domain, competitors = []) {
  const d = cleanDomain(domain);
  const [m, rows, t] = await Promise.all([meta(), lookup([d, ...competitors.slice(0, 10)]), targets()]);
  const tracked = t[d] || null;
  return {
    kind: "site", domain: d, release: m.release, domainsInGraph: m.domainsInGraph, builtAt: m.builtAt, formula: m.formula,
    you: rows[0], competitors: rows.slice(1),
    referring: tracked ? { total: tracked.referringDomains, byOA: tracked.byOA, top: tracked.top.slice(0, 50) } : null,
  };
}

const n = (x) => (x == null ? "–" : Number(x).toLocaleString("en-US"));
export function siteMarkdown(r) {
  const L = [];
  const y = r.you;
  L.push(`**getcited Site Explorer · ${r.domain}**`);
  L.push(y.oa == null ? `${r.domain} is not among the ${n(r.domainsInGraph)} domains with published authority in this release.` : `**Open Authority ${y.oa}/100** · rank #${n(y.harmonicRank)} of ${n(r.domainsInGraph)} domains by harmonic centrality · **${n(y.referringDomains)} referring domains**${y.via ? ` (measured on ${y.via})` : ""}.`);
  L.push(`Source: Common Crawl web graph ${r.release} (open data). ${r.formula}.`);
  if (r.competitors.length) {
    L.push("", "| Domain | OA | Rank | Referring domains | PageRank rank |", "|---|---:|---:|---:|---:|");
    for (const c of [y, ...r.competitors]) L.push(`| ${c === y ? `**${c.domain}** (you)` : c.domain} | ${c.oa ?? "–"} | ${c.harmonicRank ? "#" + n(c.harmonicRank) : "–"} | ${n(c.referringDomains)} | ${c.pagerankRank ? "#" + n(c.pagerankRank) : "–"} |`);
  }
  if (r.referring) {
    L.push("", `**Strongest referring domains** (${n(r.referring.total)} in total)`);
    L.push(r.referring.top.slice(0, 15).map((x) => `${x.domain} (${x.oa})`).join(", "));
    L.push("", "| OA band | Referring domains |", "|---|---:|");
    for (const b of r.referring.byOA) L.push(`| ${b.min}–${b.max} | ${n(b.count)} |`);
  }
  return L.join("\n");
}
