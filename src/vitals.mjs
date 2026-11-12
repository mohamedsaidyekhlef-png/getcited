// Core Web Vitals from Google's own data, through the official PageSpeed Insights API:
// field data from real Chrome users (CrUX, 28-day p75) for the URL and the whole origin,
// plus a Lighthouse lab run. No scraping: this is the API Google publishes for it.
// Works without a key at low volume; set PAGESPEED_API_KEY for more.

const API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const METRICS = {
  LARGEST_CONTENTFUL_PAINT_MS: { id: "lcp", label: "Largest Contentful Paint", unit: "ms", good: 2500, poor: 4000 },
  INTERACTION_TO_NEXT_PAINT: { id: "inp", label: "Interaction to Next Paint", unit: "ms", good: 200, poor: 500 },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { id: "cls", label: "Cumulative Layout Shift", unit: "", good: 0.1, poor: 0.25, scale: 100 },
  FIRST_CONTENTFUL_PAINT_MS: { id: "fcp", label: "First Contentful Paint", unit: "ms", good: 1800, poor: 3000 },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { id: "ttfb", label: "Time to First Byte", unit: "ms", good: 800, poor: 1800 },
};
const CORE = ["lcp", "inp", "cls"];

function field(exp) {
  if (!exp?.metrics) return null;
  const metrics = [];
  for (const [k, m] of Object.entries(METRICS)) {
    const x = exp.metrics[k];
    if (!x) continue;
    const p75 = m.scale ? x.percentile / m.scale : x.percentile;
    metrics.push({ id: m.id, label: m.label, unit: m.unit, p75, good: m.good, poor: m.poor, rating: p75 <= m.good ? "good" : p75 <= m.poor ? "needs improvement" : "poor", distribution: (x.distributions || []).map((d) => +(d.proportion || 0).toFixed(3)) });
  }
  const core = metrics.filter((m) => CORE.includes(m.id));
  return { id: exp.id, passes: core.length === 3 ? core.every((m) => m.rating === "good") : null, overall: exp.overall_category || null, metrics };
}

export async function vitals(url, { strategy = "mobile", key = process.env.PAGESPEED_API_KEY } = {}) {
  const target = /^https?:/i.test(url) ? url : `https://${url}`;
  const q = new URLSearchParams({ url: target, strategy, category: "performance" });
  if (key) q.set("key", key);
  const res = await fetch(`${API}?${q}`, { headers: { "user-agent": "getcited" } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { error: res.status === 429 ? "Google's PageSpeed API is rate-limiting shared requests right now. Try again in a minute." : j?.error?.message || `PageSpeed API returned HTTP ${res.status}` };
  const lh = j.lighthouseResult || {};
  const audit = (id) => lh.audits?.[id]?.numericValue;
  return {
    kind: "vitals", url: j.id || target, strategy, measuredAt: j.analysisUTCTimestamp || new Date().toISOString(),
    page: field(j.loadingExperience?.origin_fallback ? null : j.loadingExperience),
    origin: field(j.originLoadingExperience),
    lab: { performance: lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null, lcp: audit("largest-contentful-paint"), tbt: audit("total-blocking-time"), cls: audit("cumulative-layout-shift"), fcp: audit("first-contentful-paint"), speedIndex: audit("speed-index") },
    source: "Google PageSpeed Insights API v5: Chrome UX Report field data (p75, last 28 days) and a Lighthouse lab run",
  };
}

const fmt = (m) => (m.unit === "ms" ? (m.p75 >= 1000 ? `${(m.p75 / 1000).toFixed(1)} s` : `${Math.round(m.p75)} ms`) : m.p75.toFixed(2));
export function vitalsMarkdown(v) {
  if (v.error) return `getcited couldn't read Core Web Vitals: ${v.error}`;
  const L = [`**Core Web Vitals · ${v.url}** (${v.strategy})`];
  const f = v.page || v.origin;
  if (!f) L.push("Google has no field data for this page or origin: not enough real Chrome visits in the last 28 days. Lab results only.");
  else {
    L.push(`${v.page ? "This page" : "The whole origin (no page-level data)"} ${f.passes ? "**passes**" : f.passes === false ? "**fails**" : "has partial data for"} Core Web Vitals for real Chrome users (p75, 28 days).`);
    L.push("", "| Metric | p75 | Rating |", "|---|---:|---|");
    for (const m of f.metrics) L.push(`| ${m.label} | ${fmt(m)} | ${m.rating} |`);
  }
  if (v.lab.performance != null) L.push("", `Lighthouse lab performance: ${v.lab.performance}/100.`);
  L.push(`Source: ${v.source}.`);
  return L.join("\n");
}
