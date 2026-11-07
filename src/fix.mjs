import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jsonldNodes, typesOf } from "./html.mjs";

const SOCIAL = /(linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|wikipedia\.org|crunchbase\.com|tiktok\.com|threads\.net|bsky\.app)/i;

/**
 * Write ready-to-review fix files. Nothing is invented: anything the audit
 * could not find is left as an explicit "TODO" for a human (or agent) to fill.
 */
export async function writeFixes(report, dir) {
  await mkdir(dir, { recursive: true });
  const files = buildFixes(report);
  for (const f of files) await writeFile(join(dir, f.file), f.content);
  return files.map(({ file, note }) => ({ file, note }));
}

/** The same fixes as strings: [{ file, note, content }]. Nothing is invented; unknowns stay TODO. */
export function buildFixes(report) {
  const out = [];
  const put = (file, content) => out.push({ file, content, note: "" });
  const written = { push: (w) => { const f = out.find((o) => o.file === w.file); if (f) f.note = w.note; } };
  const first = report._pages[0];
  const page = first.page;
  const url = new URL(report.url);
  const origin = /^https?:/.test(url.protocol) ? url.origin : "https://example.com";
  const nodes = jsonldNodes(page.jsonld);
  const existingOrg = nodes.find((n) => typesOf(n).some((t) => /Organization|LocalBusiness|Person/.test(t)));
  const name = existingOrg?.name || page.meta["og:site_name"] || page.title.split(/\s[|–—-]\s/).pop()?.trim() || "TODO: brand name";
  const sameAs = [...new Set([...[].concat(existingOrg?.sameAs || []), ...page.anchors.map((a) => a.href).filter((h) => SOCIAL.test(h))])];

  // 1. llms.txt
  const desc = page.meta.description || page.meta["og:description"] || "TODO: one sentence on what you do and for whom.";
  const lines = [`# ${name}`, "", `> ${desc}`, ""];
  const pageList = report._pages.filter((p) => p.page).map((p) => ({ url: p.url, title: p.page.title, d: p.page.meta.description || "" }));
  lines.push("## Key pages", "");
  for (const p of pageList) lines.push(`- [${p.title || p.url}](${p.url})${p.d ? `: ${p.d}` : ""}`);
  lines.push("", "## Optional", "", `- [Sitemap](${report.site.sitemap || origin + "/sitemap.xml"})`, "");
  if (!report.site?.llms) {
    put(("llms.txt"), lines.join("\n"));
    written.push({ file: "llms.txt", note: `Publish at ${origin}/llms.txt. Add your most important pages.` });
  }

  // 2. JSON-LD
  const graph = [];
  graph.push({
    "@type": "Organization",
    "@id": origin + "/#organization",
    name,
    url: origin,
    logo: page.meta["og:image"] || "TODO: absolute URL of your logo",
    sameAs: sameAs.length ? sameAs : ["TODO: https://www.linkedin.com/company/…", "TODO: other official profile"],
  });
  const isArticle = page.headings.length > 3 && page.paragraphs.length > 5;
  const authorFound = nodes.map((n) => n.author).find(Boolean);
  graph.push({
    "@type": isArticle ? "Article" : "WebPage",
    "@id": report.url + "#main",
    url: report.url,
    [isArticle ? "headline" : "name"]: page.headings.find((h) => h.level === 1)?.text || page.title || "TODO",
    description: desc,
    inLanguage: page.lang || "TODO: e.g. en",
    datePublished: nodes.find((n) => n.datePublished)?.datePublished || "TODO: YYYY-MM-DD",
    dateModified: nodes.find((n) => n.dateModified)?.dateModified || "TODO: YYYY-MM-DD (update whenever you edit)",
    ...(isArticle ? { author: authorFound || { "@type": "Person", name: "TODO: author name", url: "TODO: author profile URL" } } : {}),
    publisher: { "@id": origin + "/#organization" },
  });
  const qHeads = page.headings.filter((h) => h.level > 1 && /\?\s*$/.test(h.text));
  if (qHeads.length >= 2) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: qHeads.slice(0, 10).map((h) => ({ "@type": "Question", name: h.text, acceptedAnswer: { "@type": "Answer", text: "TODO: paste the answer shown under this heading on the page" } })),
    });
  }
  const ld = { "@context": "https://schema.org", "@graph": graph };
  put(("schema.jsonld.html"), `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n</script>\n`);
  written.push({ file: "schema.jsonld.html", note: "Paste into the page <head>. Replace every TODO with real values, then validate at validator.schema.org." });

  // 3. robots.txt additions
  const robotsCheck = report.site.checks.find((c) => c.id === "robots-ai");
  const blocked = (robotsCheck?.table || []).filter((r) => !r.allowed && r.role !== "training");
  if (blocked.length) {
    const txt = ["# Allow AI search crawlers so your pages can be cited in AI answers.", "# Place these groups ABOVE any broader Disallow rules.", "", ...blocked.flatMap((r) => [`User-agent: ${r.bot}`, "Allow: /", ""])].join("\n");
    put(("robots-ai-additions.txt"), txt);
    written.push({ file: "robots-ai-additions.txt", note: "Merge into robots.txt." });
  }

  // 4. Canonical link, when the page has none
  if (!page.links.some((l) => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"))) {
    put(("canonical.html"), `<link rel="canonical" href="${report.url}">\n`);
    written.push({ file: "canonical.html", note: "Paste into the page <head>." });
  }

  // 5. Fix plan
  const md = ["# getcited fix plan", "", `For ${report.url}, scored ${report.score.overall}/100 (${report.score.grade}).`, "", "Work top to bottom; the first items move the score most.", ""];
  report.priorities.forEach((p, i) => md.push(`${i + 1}. **${p.title}** (${p.status}) — ${p.evidence}`, `   - Fix: ${p.fix.replace(/\n/g, "\n     ")}`, ""));
  put(("FIXES.md"), md.join("\n"));
  written.push({ file: "FIXES.md", note: "Ordered fix list." });
  return out;
}
