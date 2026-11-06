import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BOT_UAS, get, looksBlocked } from "./fetch.mjs";
import { readHtml } from "./html.mjs";
import { parseRobots } from "./robots.mjs";
import { pageChecks, priorities, score, siteChecks } from "./checks.mjs";

export function normalizeUrl(input) {
  if (/^https?:\/\//i.test(input) || input.startsWith("file://")) return input;
  return "https://" + input.replace(/^\/+/, "");
}

async function auditPage(url, opts) {
  const res = opts.html !== undefined ? { ok: true, status: 200, url, headers: new Headers(), body: opts.html, ms: 0 } : await get(url);
  if (!res.ok) return { url, error: res.error || `HTTP ${res.status}`, status: res.status };
  const page = readHtml(res.body);
  const checks = pageChecks(page, { status: res.status, ms: res.ms, headers: res.headers, finalUrl: res.url });
  return { url: res.url, status: res.status, ms: res.ms, page, checks, headers: res.headers };
}

function sameSiteLinks(page, base, limit) {
  const origin = new URL(base).origin;
  const seen = new Set([new URL(base).href.replace(/#.*/, "")]);
  const out = [];
  for (const a of page.anchors) {
    let u;
    try { u = new URL(a.href, base); } catch { continue; }
    if (u.origin !== origin) continue;
    u.hash = "";
    if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|css|js|xml|ico)$/i.test(u.pathname)) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
  }
  // Prefer shallow, content-like URLs.
  return out.sort((a, b) => new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length).slice(0, limit);
}

/**
 * Audit a URL (and optionally more pages on the same site).
 * opts: { pages = 1, file?: path to a local HTML file, probeBots = true }
 */
export async function audit(input, opts = {}) {
  const pages = Math.max(1, opts.pages || 1);
  let url = normalizeUrl(opts.url || input);
  let html;
  if (opts.file) {
    html = await readFile(opts.file, "utf8");
    if (!opts.url) url = pathToFileURL(resolve(opts.file)).href;
  }
  // A local file is audited as page content only; site checks need the live site.
  const isRemote = /^https?:/i.test(url) && !opts.file;
  const first = await auditPage(url, { html });
  if (first.error) return { url, error: first.error, status: first.status };

  // Site-level facts
  const site = { path: isRemote ? new URL(first.url).pathname || "/" : "/" };
  let sitemapUrls = [];
  if (isRemote) {
    const origin = new URL(first.url).origin;
    const [robotsRes, llmsRes] = await Promise.all([get(origin + "/robots.txt"), get(origin + "/llms.txt")]);
    site.robotsStatus = robotsRes.status;
    site.robotsError = robotsRes.error;
    if (robotsRes.ok && !/<html/i.test(robotsRes.body.slice(0, 500))) site.robots = parseRobots(robotsRes.body);
    if (llmsRes.ok && !/<html|<!doctype/i.test(llmsRes.body.slice(0, 500)) && llmsRes.body.trim().length > 20) site.llms = llmsRes.body;
    site.sitemap = site.robots?.sitemaps?.[0];
    if (!site.sitemap) {
      const sm = await get(origin + "/sitemap.xml");
      if (sm.ok && /<(urlset|sitemapindex)/i.test(sm.body)) { site.sitemap = origin + "/sitemap.xml"; sitemapUrls = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]); }
    }
    if (opts.probeBots !== false) {
      site.browserOk = first.status >= 200 && first.status < 400;
      site.browserStatus = first.status;
      site.botProbe = await Promise.all(Object.entries(BOT_UAS).map(async ([bot, ua]) => {
        const r = await get(first.url, { ua, timeoutMs: 12000 });
        const challenge = r.ok && looksBlocked(r);
        return { bot, status: r.status, error: r.error, blocked: !r.ok ? looksBlocked(r) : challenge, challenge };
      }));
    }
  }
  const sChecks = isRemote ? siteChecks(site) : [];

  // More pages, if asked
  const results = [first];
  if (pages > 1 && isRemote) {
    const candidates = [...new Set([...sameSiteLinks(first.page, first.url, pages * 3), ...sitemapUrls])].slice(0, pages - 1);
    const more = await Promise.all(candidates.map((u) => auditPage(u, {})));
    results.push(...more.filter((r) => !r.error));
  }

  const pageReports = results.map((r) => {
    const all = [...sChecks, ...r.checks];
    return { url: r.url, title: r.page.title, ms: r.ms, score: score(all), checks: r.checks, priorities: priorities(all), facts: summarize(r.page) };
  });
  const allChecks = [...sChecks, ...first.checks];
  return {
    tool: "getcited",
    version: "1.1.0",
    auditedAt: new Date().toISOString(),
    url: first.url,
    site: { checks: sChecks, robotsFound: Boolean(site.robots), llms: Boolean(site.llms), sitemap: site.sitemap || null },
    score: score(allChecks),
    priorities: priorities(allChecks),
    pages: pageReports,
    _pages: results, // raw facts for --fix (not serialised)
  };
}

function summarize(page) {
  return {
    title: page.title,
    description: page.meta.description || page.meta["og:description"] || "",
    h1: page.headings.find((h) => h.level === 1)?.text || "",
    lang: page.lang,
    siteName: page.meta["og:site_name"] || "",
    image: page.meta["og:image"] || "",
  };
}
