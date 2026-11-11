import { createHash } from "node:crypto";

// URL canonicalization, registrable domains and source typing for cited URLs.
// Engines cite the same page under many spellings (tracking parameters, fragments,
// AMP and mobile hosts, trailing slashes); the index needs one key per page.

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|yclid|mc_[a-z]+|ref|ref_src|srsltid|igshid|_hsenc|_hsmi|mkt_tok|spm|scid|cmpid|si|source|ved|usg)$/i;
// Multi-label public suffixes that matter in practice; the rest default to the last two labels.
const SUFFIX2 = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.mx", "co.za", "com.tr", "com.sg", "com.hk", "co.kr", "com.cn", "com.ar", "com.co", "co.il", "com.my", "com.ph", "com.vn", "com.eg", "co.ma"]);

export function canonUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.protocol = "https:";
  u.hash = "";
  u.username = ""; u.password = "";
  let host = u.hostname.toLowerCase().replace(/\.$/, "");
  host = host.replace(/^(www\d?|m|mobile|amp)\./, "");
  u.hostname = host;
  if (u.port === "443" || u.port === "80") u.port = "";
  const keep = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = keep.length ? "?" + new URLSearchParams(keep).toString() : "";
  let path = u.pathname.replace(/\/{2,}/g, "/").replace(/\/amp\/?$/, "/").replace(/\/index\.(html?|php)$/, "/");
  if (path.length > 1) path = path.replace(/\/$/, "");
  u.pathname = path;
  return u.toString();
}

export function domainOf(raw) {
  let host;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return null; }
  host = host.replace(/^(www\d?|m|mobile|amp)\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join(".");
  return SUFFIX2.has(last2) ? parts.slice(-3).join(".") : last2;
}

const TYPES = [
  ["forum", /(^|\.)(reddit\.com|quora\.com|stackexchange\.com|stackoverflow\.com|tripadvisor\.[a-z.]+|bogleheads\.org|news\.ycombinator\.com)$/],
  ["video", /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/],
  ["reference", /(^|\.)(wikipedia\.org|britannica\.com|investopedia\.com|law\.cornell\.edu|merriam-webster\.com)$/],
  ["government", /(\.gov|\.gov\.[a-z]{2}|\.mil|\.europa\.eu)$/],
  ["education", /(\.edu|\.ac\.[a-z]{2})$/],
  ["review", /(^|\.)(trustpilot\.com|bbb\.org|g2\.com|capterra\.com|yelp\.com|consumeraffairs\.com|glassdoor\.com|sitejabber\.com)$/],
  ["social", /(^|\.)(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|medium\.com|substack\.com)$/],
  ["news", /(^|\.)(nytimes\.com|wsj\.com|reuters\.com|bloomberg\.com|cnbc\.com|forbes\.com|cnn\.com|bbc\.co\.uk|theguardian\.com|apnews\.com|businessinsider\.com|usatoday\.com|fortune\.com|marketwatch\.com)$/],
];
const LISTICLE = /\b(best|top \d+|top-\d+|\d+ best|vs\.?|versus|reviews?|compared|alternatives|ranking|rated)\b/i;

/** Classify a cited source: own, competitor, forum, video, news, government, list, reference… */
export function sourceType(url, { title = "", brands = [] } = {}) {
  const d = domainOf(url);
  if (!d) return "unknown";
  for (const b of brands) if (b.domain && (d === b.domain || d.endsWith("." + b.domain))) return b.own ? "own" : "competitor";
  for (const [t, re] of TYPES) if (re.test(d)) return t;
  let path = "";
  try { path = new URL(url).pathname; } catch {}
  if (LISTICLE.test(title) || LISTICLE.test(path.replace(/[-_/]/g, " "))) return "list";
  return "website";
}

export function hash(s) {
  return createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
}
