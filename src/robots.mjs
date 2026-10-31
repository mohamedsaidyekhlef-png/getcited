// robots.txt evaluation following RFC 9309: the most specific user-agent group
// applies, and within it the longest matching rule wins (Allow wins ties).

/** AI crawlers that matter for being cited. `search` bots fetch pages to answer
 *  questions and link sources; `training` bots collect data for future models. */
export const AI_BOTS = [
  { ua: "OAI-SearchBot", owner: "OpenAI", role: "search", product: "ChatGPT search results" },
  { ua: "ChatGPT-User", owner: "OpenAI", role: "user", product: "ChatGPT browsing on a user's request" },
  { ua: "GPTBot", owner: "OpenAI", role: "training", product: "OpenAI model training" },
  { ua: "Claude-SearchBot", owner: "Anthropic", role: "search", product: "Claude search results" },
  { ua: "Claude-User", owner: "Anthropic", role: "user", product: "Claude fetching on a user's request" },
  { ua: "ClaudeBot", owner: "Anthropic", role: "training", product: "Anthropic model training" },
  { ua: "PerplexityBot", owner: "Perplexity", role: "search", product: "Perplexity answers" },
  { ua: "Perplexity-User", owner: "Perplexity", role: "user", product: "Perplexity fetching on a user's request" },
  { ua: "Google-Extended", owner: "Google", role: "training", product: "Gemini training and grounding" },
  { ua: "Googlebot", owner: "Google", role: "search", product: "Google Search and AI Overviews" },
  { ua: "Bingbot", owner: "Microsoft", role: "search", product: "Bing, Copilot and ChatGPT's Bing results" },
  { ua: "Applebot-Extended", owner: "Apple", role: "training", product: "Apple Intelligence training" },
  { ua: "Meta-ExternalAgent", owner: "Meta", role: "training", product: "Meta AI training" },
  { ua: "CCBot", owner: "Common Crawl", role: "training", product: "Common Crawl, used by many models" },
];

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  const sitemaps = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      if (current) current.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else if (key === "sitemap") {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(rulePath, path) {
  if (rulePath === "") return false;
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

/** Is `path` allowed for `ua`? Returns {allowed, group, rule}. */
export function isAllowed(robots, ua, path) {
  const name = ua.toLowerCase();
  let group = robots.groups.find((g) => g.agents.includes(name));
  // Product-token prefix match (e.g. "googlebot" group applies to "googlebot-image") is not needed here.
  if (!group) group = robots.groups.find((g) => g.agents.includes("*"));
  if (!group) return { allowed: true, group: null, rule: null };
  let best = null;
  for (const r of group.rules) {
    if (!ruleMatches(r.path, path)) continue;
    const len = r.path.replace(/\*/g, "").length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.rule.allow)) best = { rule: r, len };
  }
  return { allowed: best ? best.rule.allow : true, group: group.agents.includes(name) ? name : "*", rule: best?.rule ?? null };
}
