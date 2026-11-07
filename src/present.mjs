// How getcited answers inside Claude, ChatGPT and other MCP clients: a short,
// readable Markdown report for the conversation, plus compact structured data
// for the in-chat report card. Every answer states when and how it was measured,
// so the user can see the result is live, not canned.

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const short = (u) => { try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname).replace(/\/$/, ""); } catch { return u; } };
const when = (iso) => new Date(iso || Date.now()).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const ICON = { pass: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };
const CAT = { access: "Can AI reach it?", structure: "Can AI understand it?", quotability: "Is it worth quoting?", trust: "Can AI trust it?" };
const one = (s, n = 220) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const FOOT = "\n\n<sub>getcited · open-source AI search testing · scairos.com/getcited</sub>";

export function auditCard(r) {
  const checks = [...(r.site?.checks || []), ...(r.pages?.[0]?.checks || [])];
  return {
    kind: "audit",
    url: r.url,
    measuredAt: r.auditedAt,
    responseMs: r.pages?.[0]?.ms ?? null,
    title: r.pages?.[0]?.title || "",
    score: r.score,
    categories: Object.entries(r.score.byCategory).map(([id, v]) => ({ id, label: CAT[id] || id, score: v })),
    priorities: (r.priorities || []).slice(0, 6).map((p) => ({ id: p.id, title: p.title, status: p.status, category: p.category, evidence: one(p.evidence, 300), fix: one(p.fix, 400) })),
    checks: checks.map((c) => ({ id: c.id, title: c.title, status: c.status, category: c.category, evidence: one(c.evidence, 260) })),
    site: { robotsFound: Boolean(r.site?.robotsFound), llmsTxt: Boolean(r.site?.llms), sitemap: r.site?.sitemap || null },
  };
}

export function auditMarkdown(card) {
  const L = [];
  L.push(`## getcited audit: ${card.score.overall}/100 (grade ${card.score.grade})`);
  L.push(`**${short(card.url)}**${card.title ? ` · “${one(card.title, 80)}”` : ""}  `);
  L.push(`Measured live ${when(card.measuredAt)}${card.responseMs != null ? ` · page served in ${card.responseMs} ms` : ""} · raw HTML, no JavaScript, as AI crawlers read it.`);
  L.push("", "| | Score |", "|---|---|");
  for (const c of card.categories) L.push(`| ${c.label} | ${c.score ?? "–"} |`);
  const ids = ["robots-ai", "cdn-block", "server-rendered", "indexable", "llms-txt"];
  const access = card.checks.filter((c) => ids.includes(c.id));
  if (access.length) {
    L.push("", "### AI crawler access");
    for (const c of access) L.push(`- ${ICON[c.status]} **${c.title}**: ${c.evidence}`);
  }
  if (card.priorities.length) {
    L.push("", "### Fix these first");
    card.priorities.slice(0, 5).forEach((p, i) => L.push(`${i + 1}. ${ICON[p.status]} **${p.title}**${access.some((c) => c.id === p.id) ? "" : `: ${p.evidence}`}${p.fix ? `\n   *Fix:* ${p.fix}` : ""}`));
  } else L.push("", "Nothing urgent: this page is ready to be cited.");
  L.push("", `**Next:** ask “who gets cited instead of ${host(card.url)} for <your buyers' question>?” to run the Citation Arena against competitors.`);
  return L.join("\n") + FOOT;
}

export function xrayCard(url, x, fetched) {
  return {
    kind: "xray",
    url,
    measuredAt: new Date().toISOString(),
    responseMs: fetched?.ms ?? null,
    summary: x.summary,
    best: x.best.slice(0, 4).map((s) => ({ text: one(s.text, 260), score: s.score, why: s.plus })),
    worst: x.worst.slice(0, 5).map((s) => ({ text: one(s.text, 260), score: s.score, why: s.minus, verdict: s.verdict })),
  };
}

export function xrayMarkdown(c) {
  const S = c.summary;
  const L = [];
  L.push(`## Citation X-ray: ${S.quotableShare}% of sentences are quotable`);
  L.push(`**${short(c.url)}** · ${S.sentences} sentences · measured live ${when(c.measuredAt)}`);
  L.push("", `✅ ${S.quotable} quotable · ⚠️ ${S.weak} weak · ❌ ${S.dead} dead weight (${S.deadWordShare}% of the words)${S.firstQuotable > 2 ? ` · the first quotable sentence is #${S.firstQuotable + 1}, so the answer isn't up front` : ""}`);
  if (c.best.length) { L.push("", "### What an AI would quote"); c.best.forEach((s) => L.push(`- “${s.text}” (${s.score}/100: ${s.why.join(", ")})`)); }
  if (c.worst.length) { L.push("", "### Rewrite these first"); c.worst.forEach((s) => L.push(`- “${s.text}”: ${s.why.join("; ")}`)); }
  L.push("", "Quotable sentences stand alone, name their subject and state one specific fact. Marketing adjectives, “it/this” openers and calls to action are skipped by answer engines.");
  return L.join("\n") + FOOT;
}

export function arenaCard(r) {
  // Two pages from the same site would share a label: name them by path instead.
  const seen = {};
  for (const s of r.standings) seen[s.label] = (seen[s.label] || 0) + 1;
  const name = (label, url) => (seen[label] > 1 ? short(url) : label);
  const byLabel = Object.fromEntries(r.standings.map((s) => [s.url, name(s.label, s.url)]));
  r = { ...r, standings: r.standings.map((s) => ({ ...s, label: byLabel[s.url] })), context: r.context.map((p) => ({ ...p, source: seen[p.source] > 1 ? (p.url ? short(p.url) : p.source) : p.source })) };
  return {
    kind: "arena",
    question: r.question,
    measuredAt: new Date().toISOString(),
    retrieval: r.retrieval || "bm25",
    fanout: r.fanout.map((f) => f.why),
    standings: r.standings.map((s) => ({ label: s.label, url: s.url, mine: s.mine, ok: s.ok, error: s.error, share: s.share, bestRank: s.bestRank, passages: s.passages })),
    context: r.context.map((p) => ({ rank: p.rank, source: p.source, mine: p.mine, heading: p.heading, text: one(p.text, 320) })),
    gap: r.gap ? { won: r.gap.won, rank: r.gap.rank, share: r.gap.share, missingTerms: r.gap.missingTerms, advice: r.gap.advice } : null,
  };
}

export function arenaMarkdown(c) {
  const L = [];
  const me = c.standings.find((s) => s.mine);
  const lead = c.standings[0];
  L.push(`## Citation Arena: “${c.question}”`);
  L.push(me ? (c.gap?.won ? `**${me.label} wins this question** with ${pct(me.share)} of the citation share.` : me.share > 0 ? `**${me.label} is in the answer (${pct(me.share)}) but ${lead.label} leads with ${pct(lead.share)}.**` : `**${me.label} is not cited.** ${lead.label} takes ${pct(lead.share)} of the answer.`) : "");
  L.push(`Measured live ${when(c.measuredAt)} · ${c.standings.length} pages fetched · query fan-out: ${c.fanout.join(", ")}.`);
  L.push("", "| Source | Citation share | Best passage |", "|---|---|---|");
  for (const s of c.standings) L.push(`| ${s.mine ? "**" + s.label + "** (you)" : s.label} | ${s.ok ? pct(s.share) : "couldn't load"} | ${s.ok ? (s.bestRank ? "#" + s.bestRank : "no match") : s.error || ""} |`);
  if (c.gap?.advice?.length) { L.push("", "### How to take the citation"); c.gap.advice.forEach((a) => L.push(`- ${a}`)); }
  if (c.context.length) {
    L.push("", "### What the engine would read");
    c.context.slice(0, 3).forEach((p) => L.push(`${p.rank}. **${p.source}**${p.heading ? ` · ${one(p.heading, 70)}` : ""}: “${one(p.text, 200)}”`));
  }
  L.push("", "_The arena replays the retrieve-then-cite pipeline AI answer engines use (passage chunking, query fan-out, BM25 with rank fusion). It shows which passages are best placed; it doesn't reproduce any one engine's index._");
  return L.join("\n") + FOOT;
}
