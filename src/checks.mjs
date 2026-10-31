import { jsonldNodes, typesOf, wordCount } from "./html.mjs";
import { AI_BOTS, isAllowed } from "./robots.mjs";

/**
 * Every check returns { id, category, title, status, weight, evidence, fix, why }.
 * status: "pass" | "warn" | "fail" | "info". "info" never affects the score.
 */
const C = (id, category, title, weight, why) => ({ id, category, title, weight, why });

export const CATEGORIES = {
  access: { label: "Can AI reach it?", blurb: "If an AI crawler can't fetch or read the page, nothing else matters." },
  structure: { label: "Can AI understand it?", blurb: "Clear structure tells a model what the page is, who it's for and how it's organised." },
  quotability: { label: "Is it worth quoting?", blurb: "Engines lift short, specific, sourced passages. Vague pages get skipped." },
  trust: { label: "Can AI trust it?", blurb: "Authorship, dates and sources decide whether a page is safe to cite." },
};

const AUTHORITY = /(^|\.)(gov|edu|mil|int)(\.[a-z]{2})?$|(^|\.)(ac|gov|gob|gouv)\.[a-z]{2}$|(^|\.)(wikipedia\.org|doi\.org|arxiv\.org|nih\.gov|who\.int|europa\.eu|oecd\.org|worldbank\.org|imf\.org|un\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|wiley\.com|jstor\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|nber\.org|ieee\.org|acm\.org|reuters\.com|apnews\.com|bbc\.co\.uk|bbc\.com|ft\.com|economist\.com|statista\.com|pewresearch\.org|gartner\.com|mckinsey\.com|github\.com|w3\.org|ietf\.org|developer\.mozilla\.org)$/i;

const STAT = /(?:[$€£¥₹]\s?\d[\d,.\s]*\d?\s?(?:k|m|bn|million|billion)?)|(?:\b\d[\d,.]*\s?(?:%|percent\b|per cent\b|pp\b|x\b|times\b|million\b|billion\b|thousand\b|users\b|customers\b|hours?\b|days?\b|minutes?\b|seconds?\b|ms\b|kg\b|km\b|GB\b|MB\b|USD\b|EUR\b|MAD\b|GBP\b|dirhams?\b))/gi;
const QUESTION = /\?\s*$|^(how|what|why|when|where|which|who|can|does|do|is|are|should|will|comment|pourquoi|quand|quel|quelle|est-ce)\b/i;
const ABOUT = /about|contact|team|our-story|company|à-propos|a-propos|qui-sommes|equipe|من-نحن|اتصل/i;

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

function newestDate(page, headers, nodes) {
  const cands = [];
  for (const n of nodes) for (const k of ["dateModified", "datePublished", "uploadDate"]) if (n[k]) cands.push(String(n[k]));
  for (const k of ["article:modified_time", "article:published_time", "og:updated_time", "last-modified", "date", "dc.date"]) if (page.meta[k]) cands.push(page.meta[k]);
  for (const t of page.times) if (t) cands.push(t);
  const parsed = cands.map((s) => new Date(s)).filter((d) => !isNaN(d) && d.getFullYear() > 1995 && d <= new Date(Date.now() + 864e5));
  const lm = headers?.get?.("last-modified");
  const fromHeader = lm ? new Date(lm) : null;
  if (!parsed.length && fromHeader && !isNaN(fromHeader)) return { date: fromHeader, source: "HTTP Last-Modified header" };
  if (!parsed.length) return null;
  return { date: new Date(Math.max(...parsed.map(Number))), source: "structured data or <time>" };
}

/** Page-level checks. `fetchInfo` = { status, ms, headers, finalUrl }. */
export function pageChecks(page, fetchInfo) {
  const out = [];
  const add = (def, status, evidence, fix) => out.push({ ...def, status, evidence, fix });
  const url = fetchInfo.finalUrl;
  const nodes = jsonldNodes(page.jsonld);
  const types = nodes.flatMap(typesOf);
  const body = page.hasMain && wordCount(page.mainText) > 80 ? page.mainText : page.text;
  const words = wordCount(body);

  // ── Access ──────────────────────────────────────────────
  const robotsMeta = `${page.meta.robots || ""},${page.meta.googlebot || ""},${fetchInfo.headers?.get?.("x-robots-tag") || ""}`.toLowerCase();
  const indexDef = C("indexable", "access", "Page is allowed in search and AI answers", 10, "A noindex or nosnippet directive tells engines not to show or quote the page.");
  if (/noindex|\bnone\b/.test(robotsMeta)) add(indexDef, "fail", `Robots directive: "${robotsMeta.replace(/^,+|,+$/g, "")}"`, "Remove noindex from the meta robots tag or X-Robots-Tag header.");
  else if (/nosnippet|max-snippet\s*:\s*0\b/.test(robotsMeta)) add(indexDef, "fail", `Snippets are blocked: "${robotsMeta.replace(/^,+|,+$/g, "")}"`, "Remove nosnippet / max-snippet:0. Google's AI Overviews and others cannot quote a page that forbids snippets.");
  else add(indexDef, "pass", "No noindex or nosnippet directives.", "");

  const renderDef = C("server-rendered", "access", "Content is in the HTML, not only in JavaScript", 12, "Most AI crawlers do not run JavaScript. If the text only appears after scripts run, they see an empty page.");
  const spaSigns = page.rootDivs > 0 || page.scriptBytes > 60000;
  if (words < 120 && spaSigns) add(renderDef, "fail", `Only ${words} words reach a crawler, and the page looks like a JavaScript app (${page.rootDivs ? "app root element" : `${Math.round(page.scriptBytes / 1024)} KB of inline script`}).`, "Server-render or pre-render this page (SSR/SSG), so the text is in the HTML response.");
  else if (words < 120) add(renderDef, "warn", `Only ${words} words of text in the HTML.`, "Add real content to the page, or make sure it is rendered on the server.");
  else add(renderDef, "pass", `${words.toLocaleString("en")} words of text in the HTML response.`, "");

  const speedDef = C("response-time", "access", "Responds quickly", 4, "Crawlers fetch pages live while answering; slow pages get dropped.");
  if (fetchInfo.ms > 5000) add(speedDef, "fail", `HTML took ${(fetchInfo.ms / 1000).toFixed(1)} s.`, "Cache the HTML at the edge or speed up the server; aim for under 1.5 s.");
  else if (fetchInfo.ms > 2000) add(speedDef, "warn", `HTML took ${(fetchInfo.ms / 1000).toFixed(1)} s.`, "Aim for under 1.5 s for the HTML response.");
  else add(speedDef, "pass", fetchInfo.ms ? `HTML in ${fetchInfo.ms} ms.` : "Local file.", "");

  // ── Structure ───────────────────────────────────────────
  const titleDef = C("title", "structure", "Clear page title", 4, "The title is the first thing a model reads to decide what the page answers.");
  const tl = page.title.length;
  if (!tl) add(titleDef, "fail", "No <title>.", "Add a <title> that says what the page answers, in 30–60 characters.");
  else if (tl < 15 || tl > 70) add(titleDef, "warn", `"${page.title}" (${tl} characters).`, "Keep the title between 15 and 70 characters and lead with the topic.");
  else add(titleDef, "pass", `"${page.title}"`, "");

  const descDef = C("description", "structure", "Meta description summarises the page", 3, "Engines use it as a ready-made summary of what the page offers.");
  const d = page.meta.description || page.meta["og:description"] || "";
  if (!d) add(descDef, "fail", "No meta description.", "Add a 120–160 character description that states the answer or offer plainly.");
  else if (d.length < 50 || d.length > 200) add(descDef, "warn", `${d.length} characters: "${d.slice(0, 90)}${d.length > 90 ? "…" : ""}"`, "Aim for 50–160 characters.");
  else add(descDef, "pass", `"${d.slice(0, 110)}${d.length > 110 ? "…" : ""}"`, "");

  const hDef = C("headings", "structure", "One H1 and a clear outline", 5, "Headings are how models split a page into answerable sections.");
  const h1 = page.headings.filter((h) => h.level === 1);
  const h2 = page.headings.filter((h) => h.level === 2);
  if (h1.length === 0) add(hDef, "fail", "No H1.", "Add one H1 that names the topic of the page.");
  else if (h1.length > 1) add(hDef, "warn", `${h1.length} H1s: ${h1.slice(0, 3).map((h) => `"${h.text.slice(0, 40)}"`).join(", ")}`, "Use exactly one H1; turn the others into H2s.");
  else if (words > 600 && h2.length < 2) add(hDef, "warn", `One H1, but only ${h2.length} H2 for ${words} words.`, "Break long content into H2 sections, one question or idea each.");
  else add(hDef, "pass", `H1 "${h1[0].text.slice(0, 60)}", ${h2.length} H2 sections.`, "");

  const ldDef = C("structured-data", "structure", "Structured data (JSON-LD) describes the page", 8, "Schema.org markup states facts — who, what, when, price, rating — in a form machines read without guessing.");
  if (page.jsonldErrors.length) add(ldDef, "fail", `JSON-LD that doesn't parse: ${page.jsonldErrors[0]}`, "Fix the JSON syntax in the <script type=\"application/ld+json\"> block; invalid markup is ignored.");
  else if (!nodes.length) add(ldDef, "fail", "No JSON-LD found.", "Add Organization (or Person) and an Article, Product, FAQPage or WebPage block. `getcited --fix` drafts one.");
  else {
    const useful = types.filter((t) => /Article|BlogPosting|NewsArticle|Product|FAQPage|HowTo|LocalBusiness|Organization|Person|Service|Recipe|Event|Course|SoftwareApplication|Review|QAPage|WebPage|Dataset/.test(t));
    add(ldDef, useful.length ? "pass" : "warn", `Types: ${[...new Set(types)].join(", ")}`, useful.length ? "" : "Add a specific type (Article, Product, FAQPage, Organization…) rather than only generic nodes.");
  }

  const entDef = C("entity", "structure", "Brand is defined as an entity", 4, "sameAs links tie your brand to profiles models already know (LinkedIn, Wikipedia, Crunchbase…).");
  const org = nodes.find((n) => typesOf(n).some((t) => /Organization|LocalBusiness|Person|Corporation/.test(t)));
  if (!org) add(entDef, "warn", "No Organization or Person node.", "Add an Organization (or Person) node with name, url, logo and sameAs links to your official profiles.");
  else {
    const same = [].concat(org.sameAs || []);
    add(entDef, same.length >= 2 ? "pass" : "warn", `${typesOf(org)[0]} "${org.name || "(no name)"}" with ${same.length} sameAs link${same.length === 1 ? "" : "s"}.`, same.length >= 2 ? "" : "Add sameAs links to at least two official profiles (LinkedIn, Wikipedia, Crunchbase, GitHub, X…).");
  }

  const langDef = C("lang", "structure", "Language is declared", 2, "Lets engines match the page to questions asked in that language.");
  add(langDef, page.lang ? "pass" : "warn", page.lang ? `lang="${page.lang}"` : "No lang attribute on <html>.", page.lang ? "" : 'Add lang="en" (or your language) to the <html> tag.');

  const canDef = C("canonical", "structure", "Canonical URL", 2, "Stops duplicate versions of a page splitting its authority.");
  const canonical = page.links.find((l) => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"));
  if (!canonical) add(canDef, "warn", "No canonical link.", `Add <link rel="canonical" href="${url}">.`);
  else add(canDef, "pass", canonical.href, "");

  // ── Quotability ─────────────────────────────────────────
  const pool = page.paragraphs.filter((p) => wordCount(p.text) >= 8);
  const firstMain = pool.find((p) => p.inMain) || pool[0];
  const afDef = C("answer-first", "quotability", "Answers up front", 10, "Engines quote short, self-contained passages. If the answer is buried in paragraph four, another page gets quoted.");
  if (!firstMain) add(afDef, "fail", "No paragraph text found.", "Open with a 1–3 sentence paragraph that directly answers the page's main question.");
  else {
    const w = wordCount(firstMain.text);
    const sample = `"${firstMain.text.slice(0, 140)}${firstMain.text.length > 140 ? "…" : ""}"`;
    if (w > 110) add(afDef, "warn", `The opening paragraph is ${w} words: ${sample}`, "Put a 40–80 word direct answer first; move background after it.");
    else add(afDef, "pass", `Opening paragraph is ${w} words: ${sample}`, "");
  }

  const statDef = C("statistics", "quotability", "Specific numbers and statistics", 8, "In the GEO study (KDD 2024), adding statistics was one of the strongest ways to increase visibility in AI answers.");
  const stats = (body.match(STAT) || []).filter((s) => !/^(19|20)\d{2}$/.test(s.trim()));
  const per1k = words ? (stats.length / words) * 1000 : 0;
  if (words < 120) add(statDef, "info", "Not enough text to judge.", "");
  else if (per1k >= 4) add(statDef, "pass", `${stats.length} figures (${per1k.toFixed(1)} per 1,000 words), e.g. ${stats.slice(0, 3).map((s) => `"${s.trim()}"`).join(", ")}.`, "");
  else if (stats.length) add(statDef, "warn", `${stats.length} figure${stats.length === 1 ? "" : "s"} in ${words} words (${per1k.toFixed(1)} per 1,000).`, "Add concrete, sourced numbers: prices, results, time saved, market sizes. Never invent them.");
  else add(statDef, "fail", `No figures in ${words} words.`, "Add concrete, sourced numbers. Specific claims get quoted; vague ones don't.");

  const citeDef = C("citations", "quotability", "Cites authoritative sources", 7, "Pages that link their claims to primary sources were cited markedly more often in the GEO study.");
  const host = hostOf(url);
  const outbound = page.anchors.filter((a) => /^https?:/i.test(a.href) && hostOf(a.href) && hostOf(a.href) !== host);
  const authoritative = [...new Set(outbound.map((a) => hostOf(a.href)).filter((h) => AUTHORITY.test(h)))];
  if (words < 120) add(citeDef, "info", "Not enough text to judge.", "");
  else if (authoritative.length >= 2) add(citeDef, "pass", `Links to ${authoritative.slice(0, 4).join(", ")}${authoritative.length > 4 ? "…" : ""}.`, "");
  else if (outbound.length) add(citeDef, "warn", `${outbound.length} outbound link${outbound.length === 1 ? "" : "s"}, ${authoritative.length} to recognised authorities.`, "Back key claims with links to primary sources: official statistics, research, standards bodies.");
  else add(citeDef, "fail", "No outbound links to sources.", "Link each key claim to its primary source.");

  const quoteDef = C("quotations", "quotability", "Quotes from people or experts", 4, "Attributed quotations were another top-performing signal in the GEO study.");
  const quoted = (body.match(/[“"][^"”]{25,300}[”"]\s*[,.—-]?\s*(said|says|writes|wrote|explains|according to|—)/gi) || []).length + page.blockquotes.length;
  if (words < 120) add(quoteDef, "info", "Not enough text to judge.", "");
  else add(quoteDef, quoted ? "pass" : "warn", quoted ? `${quoted} attributed quotation${quoted === 1 ? "" : "s"}.` : "No attributed quotations.", quoted ? "" : "Add one or two real quotes from named experts, customers or your own team, with attribution.");

  const fmtDef = C("extractable", "quotability", "Lists, tables or Q&A that are easy to lift", 5, "Bullets, tables and question headings map directly onto how answers are written.");
  const qHeads = page.headings.filter((h) => h.level > 1 && QUESTION.test(h.text));
  const hasFaq = types.some((t) => /FAQPage|QAPage/.test(t));
  const fmtScore = (page.lists > 0) + (page.tables > 0) + (qHeads.length > 0 || hasFaq);
  if (words < 120) add(fmtDef, "info", "Not enough text to judge.", "");
  else add(fmtDef, fmtScore >= 2 ? "pass" : fmtScore === 1 ? "warn" : "fail",
    `${page.lists} list${page.lists === 1 ? "" : "s"}, ${page.tables} table${page.tables === 1 ? "" : "s"}, ${qHeads.length} question heading${qHeads.length === 1 ? "" : "s"}${hasFaq ? ", FAQ markup" : ""}.`,
    fmtScore >= 2 ? "" : "Turn key facts into a list or table, and phrase some H2s as the questions customers actually ask.");

  const depthDef = C("depth", "quotability", "Enough substance to answer from", 4, "Thin pages rarely contain a quotable answer.");
  if (words >= 500) add(depthDef, "pass", `${words.toLocaleString("en")} words.`, "");
  else if (words >= 250) add(depthDef, "warn", `${words} words.`, "Expand with specifics: who it's for, how it works, costs, examples, FAQs.");
  else add(depthDef, "fail", `${words} words.`, "A page needs real substance (usually 500+ words) to be a source an engine can quote.");

  // ── Trust ───────────────────────────────────────────────
  const authDef = C("author", "trust", "Named author or publisher", 5, "Engines prefer content with a clear, accountable source.");
  const ldAuthor = nodes.map((n) => n.author).find(Boolean);
  const authorName = ldAuthor ? [].concat(ldAuthor).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).join(", ") : page.meta.author || page.meta["article:author"] || "";
  const relAuthor = page.links.some((l) => /\bauthor\b/i.test(l.rel || "")) || page.anchors.some((a) => /\bauthor\b/i.test(a.rel));
  if (authorName) add(authDef, "pass", `Author: ${authorName}`, "");
  else if (relAuthor || org) add(authDef, "warn", relAuthor ? "Author link, but no named author in markup." : `Publisher "${org?.name || ""}" only, no named author.`, "Add a named author (JSON-LD author with name and url) and a short bio on the page.");
  else add(authDef, "fail", "No author or publisher found.", "Add a named author and an Organization publisher in JSON-LD, plus a visible byline.");

  const freshDef = C("freshness", "trust", "Recently updated", 6, "AI answers favour current information, and many engines show dates next to sources.");
  const nd = newestDate(page, fetchInfo.headers, nodes);
  if (!nd) add(freshDef, "warn", "No publish or update date found.", "Add datePublished and dateModified to JSON-LD and show the date on the page.");
  else {
    const days = Math.round((Date.now() - nd.date) / 864e5);
    const when = nd.date.toISOString().slice(0, 10);
    if (days <= 365) add(freshDef, "pass", `Updated ${when} (${days} days ago, from ${nd.source}).`, "");
    else if (days <= 730) add(freshDef, "warn", `Last updated ${when} (${Math.round(days / 30)} months ago).`, "Refresh the content and update dateModified.");
    else add(freshDef, "fail", `Last updated ${when} (${(days / 365).toFixed(1)} years ago).`, "Review and update the page; stale pages lose citations to newer ones.");
  }

  const httpsDef = C("https", "trust", "Served over HTTPS", 2, "Insecure pages are deprioritised as sources.");
  if (url.startsWith("file:")) add(httpsDef, "info", "Local file.", "");
  else add(httpsDef, url.startsWith("https:") ? "pass" : "fail", url.startsWith("https:") ? "HTTPS." : "Served over plain HTTP.", url.startsWith("https:") ? "" : "Serve the site over HTTPS and redirect HTTP to it.");

  const aboutDef = C("about", "trust", "About and contact pages are linked", 3, "Shows a real, reachable organisation behind the content.");
  const aboutLinks = page.anchors.filter((a) => ABOUT.test(a.href) || /^(about|contact|team|à propos|contact us|about us)$/i.test(a.text));
  add(aboutDef, aboutLinks.length ? "pass" : "warn", aboutLinks.length ? `Links to ${[...new Set(aboutLinks.map((a) => a.text || a.href))].slice(0, 3).join(", ")}.` : "No About or Contact link found.", aboutLinks.length ? "" : "Link to an About page and a Contact page from every page (header or footer).");

  return out;
}

/** Site-level checks: robots.txt, CDN blocking, llms.txt, sitemap. */
export function siteChecks(site) {
  const out = [];
  const add = (def, status, evidence, fix, extra = {}) => out.push({ ...def, status, evidence, fix, ...extra });
  const path = site.path || "/";

  const robotsDef = C("robots-ai", "access", "AI search crawlers are allowed in robots.txt", 14, "Search crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot, Bingbot) fetch pages to answer questions and link sources. Blocking them removes you from those answers.");
  const trainDef = C("robots-training", "access", "AI training crawlers", 0, "Training crawlers collect data for future models. Blocking them is a business choice and does not remove you from live AI search.");
  if (!site.robots) {
    add(robotsDef, "pass", site.robotsStatus === 404 ? "No robots.txt, so every crawler is allowed." : `robots.txt not readable (${site.robotsStatus || site.robotsError}); crawlers treat this as allowed.`, "");
  } else {
    const rows = AI_BOTS.map((b) => ({ ...b, ...isAllowed(site.robots, b.ua, path) }));
    const blockedSearch = rows.filter((r) => !r.allowed && r.role !== "training");
    const blockedTrain = rows.filter((r) => !r.allowed && r.role === "training");
    add(robotsDef, blockedSearch.length ? "fail" : "pass",
      blockedSearch.length ? `Blocked for ${path}: ${blockedSearch.map((r) => `${r.ua} (${r.product})`).join("; ")}.` : `All ${rows.filter((r) => r.role !== "training").length} AI search and user crawlers may fetch ${path}.`,
      blockedSearch.length ? `Allow ${blockedSearch.map((r) => r.ua).join(", ")} in robots.txt:\n${blockedSearch.map((r) => `User-agent: ${r.ua}\nAllow: /`).join("\n\n")}` : "",
      { table: rows.map((r) => ({ bot: r.ua, owner: r.owner, role: r.role, allowed: r.allowed, rule: r.rule ? `${r.rule.allow ? "Allow" : "Disallow"}: ${r.rule.path} (group ${r.group})` : r.group ? `no rule (group ${r.group})` : "no group" })) });
    add(trainDef, "info", blockedTrain.length ? `Blocked: ${blockedTrain.map((r) => r.ua).join(", ")}. That's your call; it keeps you out of training data, not out of AI search.` : "No training crawlers blocked.", "");
  }

  const cdnDef = C("cdn-block", "access", "Your server or CDN lets AI crawlers through", 14, "Firewalls and CDNs (for example Cloudflare's AI-bot blocking) can reject AI crawlers even when robots.txt allows them. This is invisible unless you test with their real user agents.");
  if (site.botProbe) {
    const blocked = site.botProbe.filter((p) => p.blocked);
    if (!site.browserOk) add(cdnDef, "info", `The page itself didn't load for a normal browser (${site.browserStatus}), so bot access wasn't compared.`, "");
    else add(cdnDef, blocked.length ? "fail" : "pass",
      blocked.length ? `Rejected: ${blocked.map((p) => `${p.bot} → ${p.status || p.error}${p.challenge ? " (challenge page)" : ""}`).join(", ")}. A normal browser gets ${site.browserStatus}.` : `${site.botProbe.map((p) => `${p.bot} ${p.status}`).join(", ")}: same content as a browser.`,
      blocked.length ? "Allow verified AI search crawlers in your CDN or firewall (in Cloudflare: Security → Bots, and AI Crawl Control). Keep training bots blocked if you prefer." : "");
  }

  const llmsDef = C("llms-txt", "structure", "llms.txt guide for AI", 2, "A plain-Markdown map of your key pages for AI tools. Low cost; adoption by the big engines is still limited, so it's a small bonus, not a fix.");
  add(llmsDef, site.llms ? "pass" : "warn", site.llms ? `Found /llms.txt (${site.llms.split("\n").length} lines).` : "No /llms.txt.", site.llms ? "" : "Add /llms.txt. `getcited --fix` drafts one from your pages.");

  const smDef = C("sitemap", "access", "Sitemap is published", 3, "Helps crawlers find every page, including new ones.");
  add(smDef, site.sitemap ? "pass" : "warn", site.sitemap ? `Sitemap: ${site.sitemap}` : "No sitemap found in robots.txt or at /sitemap.xml.", site.sitemap ? "" : "Publish /sitemap.xml and reference it in robots.txt with a Sitemap: line.");
  return out;
}

/** Weighted 0–100 score, overall and per category. */
export function score(checks) {
  const pts = { pass: 1, warn: 0.5, fail: 0 };
  const scored = checks.filter((c) => c.status !== "info" && c.weight > 0);
  const total = scored.reduce((s, c) => s + c.weight, 0);
  const got = scored.reduce((s, c) => s + c.weight * pts[c.status], 0);
  const byCat = {};
  for (const cat of Object.keys(CATEGORIES)) {
    const cs = scored.filter((c) => c.category === cat);
    const t = cs.reduce((s, c) => s + c.weight, 0);
    byCat[cat] = t ? Math.round((cs.reduce((s, c) => s + c.weight * pts[c.status], 0) / t) * 100) : null;
  }
  const overall = total ? Math.round((got / total) * 100) : 0;
  const grade = overall >= 90 ? "A" : overall >= 75 ? "B" : overall >= 60 ? "C" : overall >= 40 ? "D" : "F";
  return { overall, grade, byCategory: byCat };
}

/** Failing and warning checks, most damaging first. */
export function priorities(checks) {
  return checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .map((c) => ({ ...c, impact: c.weight * (c.status === "fail" ? 1 : 0.5) }))
    .sort((a, b) => b.impact - a.impact);
}
