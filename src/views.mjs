// Terminal, Markdown and HTML views for xray, arena, test and truth.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
export const colors = (on) => on
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m` }
  : Object.fromEntries(["g", "y", "r", "d", "b", "c"].map((k) => [k, (s) => s]));
const bar = (x, w = 24) => "█".repeat(Math.round(x * w)) + "░".repeat(w - Math.round(x * w));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- X-ray ----------
export function xrayTerminal(url, x, color) {
  const c = colors(color), S = x.summary, L = [];
  const tint = { quotable: c.g, weak: c.y, dead: c.r };
  L.push("", c.b(`getcited xray  ${url}`));
  L.push(`${c.b(`${S.quotableShare}%`)} of ${S.sentences} sentences are quotable  ·  ${c.g(`${S.quotable} quotable`)}  ${c.y(`${S.weak} weak`)}  ${c.r(`${S.dead} dead weight`)}  ·  ${S.deadWordShare}% of words are dead weight`);
  if (S.firstQuotable > 3) L.push(c.y(`  The first quotable sentence is sentence ${S.firstQuotable + 1}. Engines favour pages that answer at the top.`));
  L.push("", c.b("Most quotable (what an AI would lift)"));
  x.best.forEach((s) => L.push(`  ${c.g(String(s.score).padStart(3))}  ${clip(s.text, 110)}  ${c.d(s.plus.join(", "))}`));
  L.push("", c.b("Dead weight (rewrite or cut)"));
  x.worst.forEach((s) => L.push(`  ${tint[s.verdict](String(s.score).padStart(3))}  ${clip(s.text, 110)}  ${c.d(s.minus.join("; "))}`));
  L.push("");
  return L.join("\n");
}

export function xrayHtml(url, x) {
  const S = x.summary;
  const body = x.layout.map((b) => b.h
    ? `<h${Math.min(6, b.level + 1)}>${esc(b.h)}</h${Math.min(6, b.level + 1)}>`
    : `<p class="${b.tag === "li" ? "li" : ""}">${b.s.map((i) => { const s = x.sentences[i]; return `<span class="s ${s.verdict}" tabindex="0" data-r="${esc([`${s.score}/100`, ...s.plus.map((p) => "+ " + p), ...s.minus.map((m) => "− " + m)].join("\n"))}">${esc(s.text)}</span>`; }).join(" ")}</p>`).join("\n");
  return page(`X-ray · ${url}`, `
<div class="hero"><div class="big">${S.quotableShare}<small>%</small></div><div><h1>Citation X-ray</h1><p class="sub">${esc(url)}</p>
<p>${S.quotableShare}% of ${S.sentences} sentences are ones an AI answer engine would quote. ${S.deadWordShare}% of the words are dead weight.</p>
<div class="legend"><span class="s quotable">quotable ${S.quotable}</span> <span class="s weak">weak ${S.weak}</span> <span class="s dead">dead weight ${S.dead}</span></div></div></div>
<section class="doc"><p class="hint">Hover or tap a sentence to see why.</p>${body}</section>
<section><h2>Rewrite these first</h2><ol>${x.worst.map((s) => `<li><q>${esc(s.text)}</q><br><small>${esc(s.minus.join("; "))}</small></li>`).join("")}</ol></section>`);
}

// ---------- Arena ----------
export function arenaTerminal(r, color) {
  const c = colors(color), L = [];
  L.push("", c.b(`getcited arena  "${r.question}"`));
  L.push(c.d(`  fan-out: ${r.fanout.map((f) => f.why).join(" · ")}   context: top ${r.k} passages`));
  L.push("", c.b("Citation share (offline retrieval)"));
  for (const s of r.standings) {
    const name = (s.mine ? "★ " : "  ") + clip(s.label, 28);
    L.push(`  ${(s.mine ? c.c : (x) => x)(name.padEnd(31))} ${s.mine ? c.c(bar(s.share)) : bar(s.share)} ${pct(s.share).padStart(4)}  ${c.d(s.ok ? s.bestRank ? `best passage #${s.bestRank} · ${s.inContext}/${r.k} in context` : `no passage matched (${s.passages} indexed)` : `couldn't load: ${s.error}`)}`);
  }
  if (r.live) {
    L.push("", c.b(`Live answers (${r.live.model}, ${r.live.samples ?? 0} samples, shuffled order)`));
    if (r.live.error) L.push(c.r(`  ${r.live.error}`));
    else {
      for (const s of r.live.share) L.push(`  ${(s.mine ? "★ " : "  ") + clip(s.label, 28).padEnd(29)} ${bar(s.share)} ${pct(s.share).padStart(4)}  ${c.d(`cited in ${s.citedIn}/${r.live.samples}`)}`);
      L.push("", c.d("  " + clip(r.live.answer.replace(/\s+/g, " "), 400)));
    }
  }
  L.push("", c.b("Context the engine would read"));
  r.context.forEach((p) => L.push(`  ${p.rank}. ${p.mine ? c.c(p.source) : p.source}  ${c.d(clip(p.heading || "", 40))}\n     ${clip(p.text.replace(/\s+/g, " "), 150)}`));
  if (r.gap) {
    L.push("", r.gap.won ? c.g(c.b("You win this question.")) : c.b(`Why you ${r.gap.inContext ? "aren't first" : "aren't cited"}`));
    r.gap.advice.forEach((a) => L.push(`  → ${a}`));
  }
  L.push("");
  return L.join("\n");
}

export function arenaMarkdown(r) {
  const out = [`## "${r.question}"`, "", "| Source | Citation share | Best rank |", "|---|---|---|"];
  for (const s of r.standings) out.push(`| ${s.mine ? "**★ " + s.label + "**" : s.label} | ${pct(s.share)} | ${s.bestRank ?? "–"} |`);
  if (r.live && !r.live.error) out.push("", `Live (${r.live.model}): ` + r.live.share.map((s) => `${s.label} ${pct(s.share)}`).join(", "));
  if (r.gap?.advice?.length) out.push("", ...r.gap.advice.map((a) => `- ${a}`));
  return out.join("\n");
}

export function arenaHtml(r) {
  const rows = r.standings.map((s) => `<tr class="${s.mine ? "me" : ""}"><td>${s.mine ? "★ " : ""}${esc(s.label)}</td><td class="barcell"><span class="bar" style="width:${Math.max(1, s.share * 100)}%"></span></td><td><b>${pct(s.share)}</b></td><td>${s.bestRank ?? "–"}</td></tr>`).join("");
  const live = r.live && !r.live.error ? `<section><h2>Live answers · ${esc(r.live.model)}</h2><p class="sub">${r.live.samples} samples, passages shuffled each time to cancel position bias.</p><table>${r.live.share.map((s) => `<tr class="${s.mine ? "me" : ""}"><td>${esc(s.label)}</td><td class="barcell"><span class="bar" style="width:${Math.max(1, s.share * 100)}%"></span></td><td><b>${pct(s.share)}</b></td><td>cited in ${s.citedIn}/${r.live.samples}</td></tr>`).join("")}</table><blockquote>${esc(r.live.answer)}</blockquote></section>` : "";
  return page(`Arena · ${r.question}`, `
<div class="hero"><div class="big">${r.gap ? pct(r.gap.share).replace("%", "<small>%</small>") : "–"}</div><div><h1>${esc(r.question)}</h1><p class="sub">Citation Arena · ${r.standings.length} sources · top ${r.k} passages · fan-out: ${esc(r.fanout.map((f) => f.why).join(", "))}</p>
${r.gap ? `<p>${r.gap.won ? "<b>You win this question.</b>" : r.gap.inContext ? `<b>You're in the answer, not first.</b> Winner: ${esc(r.gap.winner?.source)}.` : `<b>You're not cited.</b> Winner: ${esc(r.standings[0].label)}.`}</p>` : ""}</div></div>
<section><h2>Citation share</h2><table><thead><tr><th>Source</th><th></th><th>Share</th><th>Best rank</th></tr></thead><tbody>${rows}</tbody></table></section>
${live}
${r.gap?.advice?.length ? `<section class="adv"><h2>How to take the citation</h2><ol>${r.gap.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ol></section>` : ""}
<section><h2>What the engine reads</h2><ol class="ctx">${r.context.map((p) => `<li class="${p.mine ? "me" : ""}"><b>${esc(p.source)}</b> <small>${esc(p.heading)}</small><p>${esc(p.text)}</p></li>`).join("")}</ol></section>`);
}

// ---------- test ----------
export function testTerminal(run, color) {
  const c = colors(color), L = [""];
  const icon = { pass: c.g("✓"), fail: c.r("✗"), skip: c.d("○") };
  L.push(c.b(`getcited test  ${run.site || ""}`) + (run.model ? c.d(`  live: ${run.model}`) : c.d("  offline")));
  for (const t of run.tests) {
    L.push(`  ${icon[t.status]} ${t.name}  ${c.d(t.detail || "")}`);
    if (t.status === "fail" && t.advice) L.push(c.y(`      → ${t.advice}`));
  }
  L.push("", `${run.failed ? c.r(`${run.failed} failed`) : c.g("all passed")}, ${run.passed} passed${run.skipped ? `, ${run.skipped} skipped` : ""}` + (run.questions ? c.d(`  ·  in the answer for ${run.citedIn}/${run.questions} questions, average share ${pct(run.averageShare)}`) : ""), "");
  return L.join("\n");
}

export function testMarkdown(run) {
  const icon = { pass: "✅", fail: "❌", skip: "⏭️" };
  const out = [`### getcited: ${run.failed ? `${run.failed} citation test(s) failed` : "all citation tests passed"}`, "", `${run.passed} passed · ${run.failed} failed · ${run.skipped} skipped${run.questions ? ` · in the answer for ${run.citedIn}/${run.questions} questions · average citation share ${pct(run.averageShare)}` : ""}${run.model ? ` · live model ${run.model}` : ""}`, "", "| | Test | Result |", "|---|---|---|"];
  for (const t of run.tests) out.push(`| ${icon[t.status]} | ${t.name.replace(/\|/g, "\\|")} | ${(t.detail || "").replace(/\|/g, "\\|")} |`);
  const fixes = run.tests.filter((t) => t.status === "fail" && t.advice);
  if (fixes.length) out.push("", "**How to fix**", "", ...fixes.map((t) => `- ${t.question ? `_${t.question}_: ` : ""}${t.advice}`));
  out.push("", "<sub>[getcited](https://github.com/mohamedsaidyekhlef-png/getcited) citation tests</sub>", "");
  return out.join("\n");
}

// ---------- truth ----------
export function truthTerminal(t, color) {
  const c = colors(color), L = [""];
  const icon = { correct: c.g("✓"), wrong: c.r("✗"), unverifiable: c.d("?") };
  L.push(c.b(`getcited truth  ${t.brand}`) + c.d(`  model: ${t.model}`));
  L.push(t.accuracy === null ? c.y(t.summary) : (t.accuracy >= 0.8 ? c.g : t.accuracy >= 0.5 ? c.y : c.r)(c.b(t.summary)));
  for (const r of t.claims) L.push(`  ${icon[r.verdict]} ${r.claim}${r.verdict === "wrong" && r.fact ? c.d(`   truth: ${r.fact}`) : ""}`);
  if (t.fixes?.length) { L.push("", c.b("Set the record straight")); t.fixes.forEach((f) => L.push(`  → ${f}`)); }
  L.push("");
  return L.join("\n");
}

// ---------- page shell ----------
function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#F5F6F8;--paper:#fff;--ink:#15192A;--muted:#5B6275;--line:#DDE1E8;--pass:#13865A;--warn:#B7790A;--fail:#C8283C;--accent:#3D4FE0;--q:#13865A26;--w:#B7790A26;--d:#C8283C1f}
@media (prefers-color-scheme:dark){:root{--bg:#0F121B;--paper:#171B27;--ink:#E8EBF2;--muted:#9AA2B5;--line:#2A3040;--pass:#3CCB8C;--warn:#F0B43C;--fail:#FF6276;--accent:#8794FF;--q:#3CCB8C2e;--w:#F0B43C29;--d:#FF627624}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:32px 16px 64px}
.hero{display:flex;gap:28px;align-items:center;flex-wrap:wrap;background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:24px}
.big{font-size:64px;font-weight:850;letter-spacing:-.03em;color:var(--accent);line-height:1}.big small{font-size:28px}
h1{font-size:clamp(22px,3.4vw,30px);margin:0 0 4px;letter-spacing:-.01em}.sub{color:var(--muted);margin:0 0 8px;word-break:break-all}
section{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:20px 0}h2{margin:0 0 10px;font-size:20px}
table{border-collapse:collapse;width:100%}td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:15px}tr.me td{font-weight:700;color:var(--accent)}
.barcell{width:45%}.bar{display:block;height:12px;border-radius:6px;background:var(--muted)}tr.me .bar{background:var(--accent)}
.s{border-radius:4px;padding:1px 2px;cursor:help;box-decoration-break:clone;-webkit-box-decoration-break:clone}.s.quotable{background:var(--q)}.s.weak{background:var(--w)}.s.dead{background:var(--d);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--fail) 55%,transparent)}
.s:hover,.s:focus{outline:2px solid var(--accent)}.s:hover::after,.s:focus::after{content:attr(data-r);white-space:pre;position:absolute;margin-top:1.6em;left:16px;right:16px;max-width:520px;background:var(--ink);color:var(--paper);padding:8px 10px;border-radius:8px;font-size:13px;z-index:9}
.legend .s{cursor:default;margin-right:6px;padding:2px 8px}.doc{position:relative}.doc p{margin:0 0 12px}.doc p.li{padding-left:16px;border-left:3px solid var(--line)}.hint{color:var(--muted);font-size:14px}
.ctx li{margin:0 0 14px}.ctx li.me{border-left:3px solid var(--accent);padding-left:10px}.ctx p{margin:4px 0 0;color:var(--muted);font-size:14px}
.adv{border-left:4px solid var(--accent)}blockquote{margin:12px 0 0;padding:10px 14px;border-left:3px solid var(--line);color:var(--muted)}q{font-style:italic}
footer{color:var(--muted);font-size:13px;margin-top:24px}a{color:var(--accent)}
</style></head><body><div class="wrap">${inner}
<footer>Made with <a href="https://github.com/mohamedsaidyekhlef-png/getcited">getcited</a>. Offline results replicate the retrieve-then-cite pipeline AI search engines use; they approximate, and don't reproduce, any one engine.</footer>
</div></body></html>`;
}
