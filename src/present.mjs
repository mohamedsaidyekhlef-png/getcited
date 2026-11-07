// How getcited answers inside Claude, ChatGPT and other MCP clients: a dense,
// analyst-style Markdown report for the conversation, plus structured data for
// the in-chat report card. Every number comes from a live fetch made during the
// call, and the report says what was fetched, when, and what came back.

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const short = (u) => { try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname).replace(/\/+$/, ""); } catch { return u; } };
const utc = (iso) => new Date(iso || Date.now()).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const one = (s, n = 220) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const WORD = { pass: "Pass", warn: "Warning", fail: "Fail", info: "Note" };
const CAT = { access: "Access", structure: "Structure", quotability: "Quotability", trust: "Trust" };
const CAT_Q = { access: "Can AI crawlers reach it?", structure: "Can a model parse it?", quotability: "Is there a passage worth quoting?", trust: "Is it a source worth trusting?" };
const METHOD = "https://github.com/mohamedsaidyekhlef-png/getcited#how-it-works";

// Typical time to ship each fix, so a list of problems becomes a plan.
const EFFORT = {
  "robots-ai": "5 min", "cdn-block": "15 min", indexable: "5 min", "server-rendered": "1–3 days", "response-time": "1 day",
  title: "5 min", description: "10 min", headings: "30 min", "structured-data": "1 hour", entity: "30 min", lang: "2 min", canonical: "5 min",
  "llms-txt": "20 min", sitemap: "15 min", "answer-first": "30 min", freshness: "10 min", author: "20 min", sources: "1 hour", quotes: "1 hour",
};
const effort = (id, cat) => EFFORT[id] || (cat === "quotability" ? "1 hour" : cat === "trust" ? "1 hour" : "30 min");
const fence = (s) => /\n|User-agent:|<script|{\s*"/.test(s || "");

export function auditCard(r) {
  const checks = [...(r.site?.checks || []), ...(r.pages?.[0]?.checks || [])];
  const total = checks.filter((c) => c.status !== "info" && c.weight > 0).reduce((a, c) => a + c.weight, 0) || 1;
  const robots = checks.find((c) => c.id === "robots-ai");
  const cdn = checks.find((c) => c.id === "cdn-block");
  const probe = Object.fromEntries((cdn?.probe || []).map((p) => [p.bot, p]));
  const crawlers = (robots?.table || []).map((b) => ({ bot: b.bot, owner: b.owner, role: b.role, allowed: b.allowed, rule: b.rule, live: probe[b.bot] || null }));
  for (const p of cdn?.probe || []) if (!crawlers.some((c) => c.bot === p.bot)) crawlers.push({ bot: p.bot, owner: "", role: "", allowed: null, rule: "robots.txt not read", live: p });
  return {
    kind: "audit",
    url: r.url,
    measuredAt: r.auditedAt,
    responseMs: r.pages?.[0]?.ms ?? null,
    title: r.pages?.[0]?.title || "",
    facts: r.pages?.[0]?.facts || null,
    score: r.score,
    categories: Object.entries(r.score.byCategory).map(([id, v]) => ({ id, label: CAT[id] || id, question: CAT_Q[id] || "", score: v })),
    browserStatus: cdn?.browserStatus ?? null,
    crawlers,
    priorities: (r.priorities || []).slice(0, 8).map((p) => ({
      id: p.id, title: p.title, status: p.status, category: p.category, why: one(p.why, 240), evidence: one(p.evidence, 300),
      fix: String(p.fix || "").slice(0, 900), gain: Math.max(1, Math.round((p.impact / total) * 100)), effort: effort(p.id, p.category),
    })),
    checks: checks.map((c) => ({ id: c.id, title: c.title, status: c.status, category: c.category, evidence: one(c.evidence, 260) })),
    passed: checks.filter((c) => c.status === "pass").length,
    total: checks.filter((c) => c.status !== "info").length,
    site: { robotsFound: Boolean(r.site?.robotsFound), llmsTxt: Boolean(r.site?.llms), sitemap: r.site?.sitemap || null },
  };
}

export function auditMarkdown(c) {
  const L = [];
  const s = c.score.overall;
  const verdict = s >= 85 ? "ready to be cited" : s >= 70 ? "citable, with gaps" : s >= 50 ? "at risk of being skipped" : "not citable as it stands";
  L.push(`**getcited audit · ${short(c.url)}**`);
  L.push(`**${s}/100 (${c.score.grade})**, ${verdict}. ${c.passed} of ${c.total} checks pass.`);
  L.push(`Fetched ${utc(c.measuredAt)}${c.browserStatus ? `, HTTP ${c.browserStatus}` : ""}${c.responseMs != null ? ` in ${c.responseMs} ms` : ""}, read as raw HTML without JavaScript, the way AI crawlers read it.`);
  L.push("", "| Category | Score | What it measures |", "|---|---:|---|");
  for (const x of c.categories) if (x.score != null) L.push(`| ${x.label} | ${x.score} | ${x.question} |`);
  const shown = c.crawlers.filter((b) => b.role !== "training" || b.live);
  if (shown.length) {
    L.push("", "**Crawler access** (robots.txt rule, plus a live request with each crawler's real user agent)", "", "| Crawler | Operator | Purpose | robots.txt | Live request |", "|---|---|---|---|---|");
    for (const b of shown) L.push(`| ${b.bot} | ${b.owner} | ${b.role} | ${b.allowed == null ? "not read" : b.allowed ? "allowed" : "**blocked**"} | ${b.live ? (b.live.blocked ? `**${b.live.status || b.live.error} rejected**` : `${b.live.status} OK`) : "–"} |`);
  }
  if (c.priorities.length) {
    L.push("", "**Fixes, by score impact**", "", "| # | Issue | Status | Gain | Effort |", "|---:|---|---|---:|---|");
    c.priorities.slice(0, 6).forEach((p, i) => L.push(`| ${i + 1} | ${cell(p.title)} | ${WORD[p.status]} | +${p.gain} | ${p.effort} |`));
    for (const [i, p] of c.priorities.slice(0, 3).entries()) {
      L.push("", `**${i + 1}. ${p.title}.** ${p.evidence}`);
      if (p.fix) L.push(fence(p.fix) ? `\n\`\`\`\n${p.fix}\n\`\`\`` : `Fix: ${p.fix}`);
    }
  } else L.push("", "No open issues on this page.");
  L.push("", `Method: 25 checks across access, structure, quotability and trust; [how scoring works](${METHOD}).`);
  return L.join("\n");
}

export function xrayCard(url, x, fetched) {
  return {
    kind: "xray",
    url,
    measuredAt: new Date().toISOString(),
    responseMs: fetched?.ms ?? null,
    status: fetched?.status ?? null,
    summary: x.summary,
    strip: (x.strip || []).slice(0, 600),
    best: x.best.slice(0, 4).map((s) => ({ text: one(s.text, 260), score: s.score, why: s.plus })),
    worst: x.worst.slice(0, 6).map((s) => ({ text: one(s.text, 260), score: s.score, why: s.minus, verdict: s.verdict })),
  };
}

export function xrayMarkdown(c) {
  const S = c.summary;
  const L = [];
  L.push(`**getcited X-ray · ${short(c.url)}**`);
  L.push(`**${S.quotableShare}% of sentences are quotable** (${S.quotable} of ${S.sentences}). ${S.weak} weak, ${S.dead} dead weight carrying ${S.deadWordShare}% of the words. Average sentence score ${S.average}/100.`);
  L.push(`Fetched ${utc(c.measuredAt)}${c.status ? `, HTTP ${c.status}` : ""}${c.responseMs != null ? ` in ${c.responseMs} ms` : ""}. ${S.firstQuotable < 0 ? "No sentence on the page qualifies as quotable." : S.firstQuotable > 2 ? `The first quotable sentence is #${S.firstQuotable + 1}; engines favour pages that answer in the opening lines.` : "The page answers early, which engines favour."}`);
  if (c.worst.length) {
    L.push("", "**Rewrite first**", "", "| Sentence | Score | Problem |", "|---|---:|---|");
    for (const s of c.worst) L.push(`| “${cell(one(s.text, 110))}” | ${s.score} | ${cell(s.why.join("; "))} |`);
  }
  if (c.best.length) {
    L.push("", "**Most quotable**", "", "| Sentence | Score | Why it works |", "|---|---:|---|");
    for (const s of c.best) L.push(`| “${cell(one(s.text, 110))}” | ${s.score} | ${cell(s.why.join(", "))} |`);
  }
  L.push("", `Method: each sentence is scored for standalone meaning, a named subject, specific figures, attribution and length; [scoring rules](${METHOD}).`);
  return L.join("\n");
}

export function arenaCard(r) {
  // Two pages from the same site would share a label: name them by path instead.
  const seen = {};
  for (const s of r.standings) seen[s.label] = (seen[s.label] || 0) + 1;
  const nameOf = Object.fromEntries(r.standings.map((s) => [s.label + "\u0000" + s.url, seen[s.label] > 1 ? short(s.url) : s.label]));
  const label = (l, u) => nameOf[l + "\u0000" + u] || l;
  return {
    kind: "arena",
    question: r.question,
    measuredAt: new Date().toISOString(),
    retrieval: r.retrieval || "bm25",
    fanout: r.fanout.map((f) => ({ q: f.q, why: f.why, winner: f.winner })),
    standings: r.standings.map((s) => ({ label: label(s.label, s.url), url: s.url, mine: s.mine, ok: s.ok, error: s.error, share: s.share, bestRank: s.bestRank, passages: s.passages, inContext: s.inContext })),
    context: r.context.map((p) => ({ rank: p.rank, source: p.url ? label(p.source, p.url) : p.source, mine: p.mine, heading: p.heading, text: one(p.text, 320) })),
    gap: r.gap ? { won: r.gap.won, rank: r.gap.rank, share: r.gap.share, missingTerms: r.gap.missingTerms, advice: r.gap.advice } : null,
  };
}

export function arenaMarkdown(c) {
  const L = [];
  const me = c.standings.find((s) => s.mine);
  const lead = c.standings[0];
  L.push(`**getcited Citation Arena · “${c.question}”**`);
  if (me) L.push(c.gap?.won ? `**${me.label} wins** with ${pct(me.share)} of citation share.` : me.share > 0 ? `**${me.label} holds ${pct(me.share)}**; ${lead.label} leads with ${pct(lead.share)}.` : `**${me.label} is not cited.** ${lead.label} takes ${pct(lead.share)} of citation share${me.bestRank ? `; your best passage ranks #${me.bestRank}` : ""}.`);
  L.push(`Fetched ${c.standings.length} pages at ${utc(c.measuredAt)}; ${c.standings.reduce((a, s) => a + (s.passages || 0), 0)} passages ranked across ${c.fanout.length} query variants (${c.retrieval}).`);
  L.push("", "| Source | Share | Passages in answer | Best rank |", "|---|---:|---:|---:|");
  for (const s of c.standings) L.push(`| ${s.mine ? `**${s.label}** (you)` : s.label} | ${s.ok ? pct(s.share) : "failed to load"} | ${s.ok ? s.inContext ?? 0 : "–"} | ${s.ok ? (s.bestRank ? "#" + s.bestRank : "–") : cell(s.error || "")} |`);
  L.push("", "| Query variant | Intent | Top passage from |", "|---|---|---|");
  for (const f of c.fanout) L.push(`| ${cell(f.q)} | ${f.why} | ${f.winner || "–"} |`);
  if (c.gap?.advice?.length) { L.push("", "**What to change**"); c.gap.advice.forEach((a, i) => L.push(`${i + 1}. ${a}`)); }
  if (c.context[0]) L.push("", `**Passage an engine would quote first** (${c.context[0].source}${c.context[0].heading ? `, “${one(c.context[0].heading, 70)}”` : ""}):`, `> ${one(c.context[0].text, 260)}`);
  L.push("", `Method: passage chunking, query fan-out and BM25 with reciprocal rank fusion, the retrieve-then-cite pipeline answer engines use. It ranks passages on these pages; it does not query a live engine's index. [Details](${METHOD}).`);
  return L.join("\n");
}

export function simulateCard(r) {
  const card = (a) => arenaCard(a);
  const b = card(r.before), a = card(r.after);
  const meB = b.standings.find((s) => s.mine), meA = a.standings.find((s) => s.mine);
  const rows = a.standings.map((s) => ({ label: s.label, url: s.url, mine: s.mine, after: s.share, before: (b.standings.find((x) => x.url === s.url) || {}).share || 0, bestRank: s.bestRank }));
  return {
    kind: "simulate",
    question: r.question,
    url: r.mine,
    measuredAt: new Date().toISOString(),
    heading: r.heading,
    passage: r.passage,
    before: { share: meB?.share || 0, rank: meB?.bestRank ?? null, leader: b.standings[0]?.label },
    after: { share: meA?.share || 0, rank: meA?.bestRank ?? null, leader: a.standings[0]?.label, won: Boolean(a.gap?.won), leads: Boolean(meA && a.standings[0]?.mine) },
    standings: rows,
    context: a.context.slice(0, 3),
    advice: [...(a.gap?.advice || []), ...(!a.gap?.won && a.context.length && a.context.every((p) => !p.mine) ? [`The winning passages are short sections under headings that carry the question's words (e.g. “${one(a.context[0].heading, 80)}”). Split the passage into 2–4 sub-sections with "### " headings, 30–80 words each.`] : [])],
    sentences: r.sentences.map((s) => ({ text: one(s.text, 240), score: s.score, verdict: s.verdict, why: s.verdict === "quotable" ? s.plus : s.minus })),
  };
}

export function simulateMarkdown(c) {
  const L = [];
  const d = Math.round((c.after.share - c.before.share) * 100);
  L.push(`**getcited simulation · “${c.question}”**`);
  L.push(c.after.won && c.after.leads ? `**This passage takes the citation: ${pct(c.before.share)} → ${pct(c.after.share)}.** It becomes the #1 passage an engine would read, and your page leads.` : c.after.won ? `**This passage becomes the #1 passage an engine would read** (share ${pct(c.before.share)} → ${pct(c.after.share)}); ${c.after.leader} still holds slightly more of the answer.` : d > 0 ? `**Citation share rises ${pct(c.before.share)} → ${pct(c.after.share)}**, best passage #${c.before.rank ?? "–"} → #${c.after.rank ?? "–"}. ${c.after.leader} still leads.` : c.after.rank && (!c.before.rank || c.after.rank < c.before.rank) ? `**Closer, not in yet: your best passage moves #${c.before.rank ?? "–"} → #${c.after.rank}.** Engines read about the top 5 passages; ${c.after.leader} still holds them.` : `**No gain: ${pct(c.before.share)} → ${pct(c.after.share)}.** ${c.after.leader} keeps the answer; the passage needs the question's words and specific facts.`);
  L.push(`Tested ${utc(c.measuredAt)} against the live pages; the passage was placed at the top of ${short(c.url)}'s main content. Nothing was published.`);
  L.push("", "| Source | Before | After |", "|---|---:|---:|");
  for (const s of c.standings) L.push(`| ${s.mine ? `**${s.label}** (you)` : s.label} | ${pct(s.before)} | ${pct(s.after)} |`);
  L.push("", "| Sentence in your passage | Score | Verdict |", "|---|---:|---|");
  for (const s of c.sentences) L.push(`| “${cell(one(s.text, 110))}” | ${s.score} | ${s.verdict}${s.why?.length ? `: ${cell(s.why.join(", "))}` : ""} |`);
  if (!c.after.won && c.advice.length) { L.push("", "**To close the gap**"); c.advice.forEach((a, i) => L.push(`${i + 1}. ${a}`)); }
  L.push("", "Next: revise the passage and simulate again until it wins, then publish it exactly as tested.");
  return L.join("\n");
}

export function fixkitCard(url, files, measuredAt) {
  return { kind: "fixkit", url, measuredAt: measuredAt || new Date().toISOString(), files: files.map((f) => ({ file: f.file, note: f.note, content: f.content.slice(0, 12000), todos: (f.content.match(/TODO/g) || []).length })) };
}

export function fixkitMarkdown(c) {
  const L = [`**getcited fix kit · ${short(c.url)}**`, `${c.files.length} files generated ${utc(c.measuredAt)} from what is on the page now. Values getcited could not verify are marked TODO; fill them with real facts before publishing.`];
  for (const f of c.files) {
    L.push("", `**${f.file}** · ${f.note}${f.todos ? ` (${f.todos} TODO)` : ""}`);
    L.push("```" + (/\.html$/.test(f.file) ? "html" : /\.md$/.test(f.file) ? "markdown" : "text"), f.content.trim(), "```");
  }
  return L.join("\n");
}
