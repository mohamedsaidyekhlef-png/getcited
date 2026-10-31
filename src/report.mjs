import { CATEGORIES } from "./checks.mjs";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ICON = { pass: "✓", warn: "!", fail: "✗", info: "·" };

export function toJson(report) {
  const { _pages, ...rest } = report;
  return JSON.stringify(rest, (k, v) => (v instanceof Headers ? undefined : v), 2);
}

export function toTerminal(report, color = true) {
  const c = color
    ? { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
    : { g: (s) => s, y: (s) => s, r: (s) => s, d: (s) => s, b: (s) => s };
  const tint = { pass: c.g, warn: c.y, fail: c.r, info: c.d };
  const s = report.score;
  const lines = [];
  lines.push("", c.b(`getcited  ${report.url}`));
  lines.push(`${c.b(`${s.overall}/100`)}  grade ${s.grade}   ` + Object.entries(s.byCategory).map(([k, v]) => `${CATEGORIES[k].label.replace(/\?$/, "")} ${v ?? "–"}`).join(c.d("  ·  ")));
  const all = [...report.site.checks, ...report.pages[0].checks];
  for (const cat of Object.keys(CATEGORIES)) {
    lines.push("", c.b(CATEGORIES[cat].label));
    for (const ch of all.filter((x) => x.category === cat)) lines.push(`  ${tint[ch.status](ICON[ch.status])} ${ch.title}  ${c.d(ch.evidence.replace(/\n/g, " "))}`);
  }
  if (report.priorities.length) {
    lines.push("", c.b("Fix these first"));
    report.priorities.slice(0, 5).forEach((p, i) => lines.push(`  ${i + 1}. ${p.title}: ${p.fix.split("\n")[0]}`));
  }
  if (report.pages.length > 1) {
    lines.push("", c.b(`Pages (${report.pages.length})`));
    for (const p of report.pages) lines.push(`  ${String(p.score.overall).padStart(3)}  ${p.url}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function toMarkdown(report) {
  const s = report.score;
  const out = [`# getcited report: ${report.url}`, "", `**Score: ${s.overall}/100 (grade ${s.grade})** · audited ${report.auditedAt.slice(0, 16).replace("T", " ")} UTC`, ""];
  out.push("| Area | Score |", "|---|---|");
  for (const [k, v] of Object.entries(s.byCategory)) out.push(`| ${CATEGORIES[k].label} | ${v ?? "–"} |`);
  if (report.priorities.length) {
    out.push("", "## Fix these first", "");
    report.priorities.slice(0, 8).forEach((p, i) => out.push(`${i + 1}. **${p.title}** — ${p.evidence}`, `   - ${p.fix.replace(/\n/g, "\n     ")}`));
  }
  const all = [...report.site.checks, ...report.pages[0].checks];
  for (const cat of Object.keys(CATEGORIES)) {
    out.push("", `## ${CATEGORIES[cat].label}`, "", `_${CATEGORIES[cat].blurb}_`, "");
    for (const ch of all.filter((x) => x.category === cat)) out.push(`- ${ICON[ch.status]} **${ch.title}** — ${ch.evidence.replace(/\n/g, " ")}`);
  }
  if (report.pages.length > 1) {
    out.push("", "## Pages", "", "| Score | Page |", "|---|---|");
    for (const p of report.pages) out.push(`| ${p.score.overall} | ${p.url} |`);
  }
  out.push("", "<sub>Made with [getcited](https://github.com/mohamedsaidyekhlef-png/getcited).</sub>", "");
  return out.join("\n");
}

function fixHtml(fix) {
  const [head, ...rest] = fix.split("\n");
  return `<p class="f"><b>Fix:</b> ${esc(head)}</p>${rest.length ? `<pre>${esc(rest.join("\n").trim())}</pre>` : ""}`;
}

export function toHtml(report) {
  const s = report.score;
  const all = [...report.site.checks, ...report.pages[0].checks];
  const ring = (v) => {
    const r = 54, c = 2 * Math.PI * r, off = c * (1 - v / 100);
    const col = v >= 75 ? "var(--pass)" : v >= 50 ? "var(--warn)" : "var(--fail)";
    return `<svg viewBox="0 0 128 128" class="ring" role="img" aria-label="Score ${v} out of 100"><circle cx="64" cy="64" r="${r}" class="track"/><circle cx="64" cy="64" r="${r}" stroke="${col}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" class="arc"/><text x="64" y="70" text-anchor="middle">${v}</text></svg>`;
  };
  const robotsTable = report.site.checks.find((x) => x.id === "robots-ai")?.table;
  const sections = Object.keys(CATEGORIES).map((cat) => {
    const rows = all.filter((x) => x.category === cat).map((ch) => `
      <li class="${ch.status}"><span class="mark" aria-label="${ch.status}">${ICON[ch.status]}</span>
        <div><p class="t">${esc(ch.title)}</p><p class="e">${esc(ch.evidence)}</p>${ch.fix ? fixHtml(ch.fix) : ""}${ch.why ? `<p class="w">${esc(ch.why)}</p>` : ""}</div></li>`).join("");
    const v = s.byCategory[cat];
    return `<section><header><h2>${esc(CATEGORIES[cat].label)}</h2><span class="cat ${v >= 75 ? "pass" : v >= 50 ? "warn" : "fail"}">${v ?? "–"}</span></header><p class="blurb">${esc(CATEGORIES[cat].blurb)}</p><ul>${rows}</ul>
      ${cat === "access" && robotsTable ? `<details><summary>Crawler-by-crawler robots.txt result</summary><table><thead><tr><th>Crawler</th><th>Owner</th><th>Purpose</th><th>Allowed</th><th>Matching rule</th></tr></thead><tbody>${robotsTable.map((r) => `<tr><td>${esc(r.bot)}</td><td>${esc(r.owner)}</td><td>${esc(r.role)}</td><td class="${r.allowed ? "ok" : "no"}">${r.allowed ? "Yes" : "No"}</td><td>${esc(r.rule)}</td></tr>`).join("")}</tbody></table></details>` : ""}</section>`;
  }).join("");
  const prio = report.priorities.slice(0, 5).map((p) => `<li><b>${esc(p.title)}.</b> ${esc(p.fix.split("\n")[0].replace(/:$/, "."))}</li>`).join("");
  const pages = report.pages.length > 1 ? `<section><header><h2>Pages audited</h2></header><table><thead><tr><th>Score</th><th>Page</th></tr></thead><tbody>${report.pages.map((p) => `<tr><td>${p.score.overall}</td><td>${esc(p.url)}</td></tr>`).join("")}</tbody></table></section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>getcited · ${esc(report.url)}</title>
<style>
:root{--bg:#F5F6F8;--paper:#fff;--ink:#15192A;--muted:#5B6275;--line:#DDE1E8;--pass:#13865A;--warn:#B7790A;--fail:#C8283C;--accent:#3D4FE0}
@media (prefers-color-scheme:dark){:root{--bg:#0F121B;--paper:#171B27;--ink:#E8EBF2;--muted:#9AA2B5;--line:#2A3040;--pass:#3CCB8C;--warn:#F0B43C;--fail:#FF6276;--accent:#8794FF}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:32px 16px 64px}
.hero{display:flex;gap:28px;align-items:center;flex-wrap:wrap;background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:24px}
.ring{width:132px;height:132px;flex:none}.ring .track{fill:none;stroke:var(--line);stroke-width:12}.ring .arc{fill:none;stroke-width:12;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}.ring text{font-size:38px;font-weight:800;fill:var(--ink)}
h1{font-size:clamp(22px,3.4vw,30px);margin:0 0 4px;letter-spacing:-.01em;word-break:break-all}.sub{color:var(--muted);margin:0 0 14px}
.cats{display:flex;flex-wrap:wrap;gap:8px}.cats span{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px}
.prio{background:var(--paper);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:16px 20px;margin:20px 0}.prio h2{margin:0 0 8px;font-size:18px}.prio ol{margin:0;padding-left:22px}.prio li{display:list-item;margin:6px 0;padding:0;border:0}
section{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:20px 0}
section header{display:flex;justify-content:space-between;align-items:center}section h2{margin:0;font-size:20px}
.cat{font-weight:800;font-size:18px;padding:2px 12px;border-radius:999px}.cat.pass{color:var(--pass)}.cat.warn{color:var(--warn)}.cat.fail{color:var(--fail)}
.blurb{color:var(--muted);margin:4px 0 12px}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.mark{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:14px;color:#fff}
li.pass .mark{background:var(--pass)}li.warn .mark{background:var(--warn)}li.fail .mark{background:var(--fail)}li.info .mark{background:var(--muted)}
.t{margin:0;font-weight:700}.e{margin:2px 0 0;color:var(--muted);word-break:break-word}.f{margin:6px 0 0}.w{margin:6px 0 0;color:var(--muted);font-size:14px}
li.pass .f,li.pass .w{display:none}
pre{margin:6px 0 0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-x:auto}
details{margin-top:12px}summary{cursor:pointer;color:var(--accent)}table{border-collapse:collapse;width:100%;font-size:14px;margin-top:8px;display:block;overflow-x:auto}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}td.ok{color:var(--pass);font-weight:700}td.no{color:var(--fail);font-weight:700}
footer{color:var(--muted);font-size:13px;margin-top:24px}a{color:var(--accent)}
</style></head><body><div class="wrap">
<div class="hero">${ring(s.overall)}<div><h1>${esc(report.url)}</h1><p class="sub">AI citation readiness · grade ${s.grade} · ${esc(report.auditedAt.slice(0, 10))}</p>
<div class="cats">${Object.entries(s.byCategory).map(([k, v]) => `<span>${esc(CATEGORIES[k].label)} <b>${v ?? "–"}</b></span>`).join("")}</div></div></div>
${prio ? `<div class="prio"><h2>Fix these first</h2><ol>${prio}</ol></div>` : ""}
${sections}${pages}
<footer>Static checks of what AI crawlers receive. A high score makes you citable; it doesn't guarantee citations. Made with <a href="https://github.com/mohamedsaidyekhlef-png/getcited">getcited</a>.</footer>
</div></body></html>`;
}
