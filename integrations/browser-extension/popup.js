/* global chrome, getcited */
const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of ["start", "busy", "result", "error"]) $(s).hidden = s !== id; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABELS = { access: "Can AI reach it?", structure: "Can AI understand it?", quotability: "Worth quoting?", trust: "Can AI trust it?" };
let tabUrl = "", lastReport = null;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function run() {
  if (!/^https?:\/\//.test(tabUrl)) { $("errmsg").textContent = "Open a web page (http or https) to audit it."; return show("error"); }
  const origin = new URL(tabUrl).origin + "/*";
  // Permission to read this one site, asked once, only when the user clicks.
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) { $("errmsg").textContent = "getcited needs permission to read this site to audit it the way an AI crawler does."; return show("error"); }
  show("busy");
  try {
    const report = await getcited.audit(tabUrl, { pages: 1, probeBots: false });
    if (report.error) throw new Error(`Couldn't load the page: ${report.error}`);
    const page = await getcited.get(tabUrl);
    const xr = page.ok ? getcited.xray(getcited.readHtml(page.body)) : null;
    lastReport = report;
    render(report, xr);
    show("result");
  } catch (e) {
    $("errmsg").textContent = e.message || String(e);
    show("error");
  }
}

function render(r, xr) {
  const s = r.score.overall;
  const color = s >= 75 ? "var(--pass)" : s >= 50 ? "var(--warn)" : "var(--fail)";
  $("ring").style.setProperty("--p", s);
  $("ring").style.setProperty("--c", color);
  $("score").textContent = s;
  $("grade").textContent = `Grade ${r.score.grade}`;
  $("verdict").textContent = s >= 75 ? "AI engines can reach, read and quote this page." : s >= 50 ? "Citable, with gaps an engine will notice." : "AI engines will struggle to cite this page.";
  $("cats").innerHTML = Object.entries(r.score.byCategory).filter(([, v]) => v !== null)
    .map(([k, v]) => `<div class="cat"><b class="${v >= 75 ? "pass" : v >= 50 ? "warn" : "fail"}">${v}</b><span>${esc(LABELS[k] || k)}</span></div>`).join("");
  const top = r.priorities.slice(0, 4);
  $("prio").innerHTML = top.length ? top.map((p) => `<li><b class="${p.status}">${esc(p.title)}</b><span>${esc(p.fix || p.evidence || "")}</span></li>`).join("") : "<li><b class='pass'>Nothing urgent.</b></li>";
  $("xray").innerHTML = xr && xr.summary.sentences
    ? `<b>${xr.summary.quotableShare}%</b> of ${xr.summary.sentences} sentences are quotable; ${xr.summary.deadWordShare}% of words are dead weight.${xr.worst[0] ? `<br>Rewrite first: “${esc(xr.worst[0].text.slice(0, 120))}${xr.worst[0].text.length > 120 ? "…" : ""}” <span class="fail">(${esc(xr.worst[0].minus.join("; "))})</span>` : ""}`
    : "No readable sentences in the raw HTML. If the text appears only after JavaScript runs, most AI crawlers see an empty page.";
}

function openReport() {
  if (!lastReport) return;
  const blob = new Blob([getcited.toHtml(lastReport)], { type: "text/html" });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
}

(async () => {
  const tab = await currentTab();
  tabUrl = tab?.url || "";
  $("url").textContent = tabUrl || "No page";
  $("run").onclick = run;
  $("again").onclick = run;
  $("retry").onclick = () => show("start");
  $("report").onclick = openReport;
})();
