var getcited = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // integrations/browser-extension/src/engine-entry.mjs
  var engine_entry_exports = {};
  __export(engine_entry_exports, {
    audit: () => audit,
    get: () => get,
    readHtml: () => readHtml,
    toHtml: () => toHtml,
    xray: () => xray
  });

  // integrations/browser-extension/src/stubs/node.mjs
  var unsupported = () => {
    throw new Error("not available in the browser");
  };
  var readFile = unsupported;
  var pathToFileURL = (p) => new URL("file://" + p);
  var resolve = (...p) => p.join("/");

  // src/fetch.mjs
  var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 getcited/1.0";
  var BOT_UAS = {
    "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
    ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)"
  };
  var urlGuard = null;
  async function get(url, { ua = BROWSER_UA, timeoutMs = 15e3, maxBytes = 8 * 1024 * 1024 } = {}) {
    const started = Date.now();
    if (url.startsWith("file://") && !urlGuard) {
      try {
        const body = await readFile(new URL(url), "utf8");
        return { ok: true, status: 200, url, headers: new Headers({ "content-type": "text/html" }), body, ms: 0 };
      } catch (e) {
        return { ok: false, status: 0, url, headers: new Headers(), body: "", ms: 0, error: e.message };
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { "user-agent": ua, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8", "accept-language": "en;q=0.9,*;q=0.5" };
      let res, current = url;
      if (!urlGuard) res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers });
      else {
        for (let hop = 0; ; hop++) {
          await urlGuard(current);
          res = await fetch(current, { redirect: "manual", signal: ctrl.signal, headers });
          const loc = res.headers.get("location");
          if (res.status >= 300 && res.status < 400 && loc) {
            if (hop >= 5) throw new Error("too many redirects");
            current = new URL(loc, current).href;
            continue;
          }
          break;
        }
      }
      let body = "";
      if (res.body) {
        const reader = res.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) {
            ctrl.abort();
            break;
          }
          chunks.push(value);
        }
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) {
          all.set(c, off);
          off += c.length;
        }
        body = new TextDecoder("utf-8").decode(all);
      }
      return { ok: res.ok, status: res.status, url: res.url || current, headers: res.headers, body, ms: Date.now() - started };
    } catch (e) {
      const cause = e?.cause?.code || e?.cause?.message || (e.name === "AbortError" ? "timed out" : e.message);
      return { ok: false, status: 0, url, headers: new Headers(), body: "", ms: Date.now() - started, error: cause };
    } finally {
      clearTimeout(timer);
    }
  }
  function looksBlocked(res) {
    if (!res.ok && [401, 403, 406, 429, 451, 503].includes(res.status)) return true;
    if (res.status === 0) return true;
    return /cf-chl-|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare|captcha-delivery|px-captcha|Access denied/i.test(res.body.slice(0, 2e4));
  }

  // src/html.mjs
  var ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    rsquo: "\u2019",
    lsquo: "\u2018",
    rdquo: "\u201D",
    ldquo: "\u201C",
    copy: "\xA9",
    reg: "\xAE",
    trade: "\u2122",
    laquo: "\xAB",
    raquo: "\xBB",
    eacute: "\xE9",
    egrave: "\xE8",
    agrave: "\xE0",
    ccedil: "\xE7",
    middot: "\xB7",
    bull: "\u2022",
    euro: "\u20AC",
    pound: "\xA3",
    deg: "\xB0",
    times: "\xD7"
  };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }
  function parseAttrs(src) {
    const attrs = {};
    const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while (m = re.exec(src)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    return attrs;
  }
  var clean = (s) => decodeEntities(s).replace(/\s+/g, " ").trim();
  var wordCount = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  var BLOCK = /* @__PURE__ */ new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote", "figcaption", "dt", "dd", "summary"]);
  var SKIP_TEXT = /* @__PURE__ */ new Set(["nav", "footer", "header", "aside", "form", "button", "select", "label"]);
  var CLOSES_P = /* @__PURE__ */ new Set(["p", "div", "ul", "ol", "table", "section", "main", "article", "header", "footer", "nav", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "form", "figure", "hr", "dl", "details", "address", "fieldset"]);
  var INLINE = /* @__PURE__ */ new Set(["a", "b", "i", "em", "strong", "span", "code", "small", "sup", "sub", "abbr", "mark", "u", "s", "q", "cite", "time", "kbd", "br", "img", "label"]);
  var VOID = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  function readHtml(html) {
    const out = {
      lang: "",
      title: "",
      meta: {},
      links: [],
      anchors: [],
      headings: [],
      paragraphs: [],
      lists: 0,
      tables: 0,
      blockquotes: [],
      jsonld: [],
      jsonldErrors: [],
      times: [],
      scripts: 0,
      scriptBytes: 0,
      text: "",
      mainText: "",
      hasMain: false,
      rootDivs: 0,
      blocks: []
      // every visible text block in document order: { tag, text, inMain }
    };
    const re = /<!--[\s\S]*?-->|<(script|style|noscript|template|svg)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>|([^<]+)|</g;
    const stack = [];
    const blocks = [];
    let anchor = null;
    let textAll = [], textMain = [], skipDepth = 0, mainDepth = 0, titleOpen = false, titleText = "";
    let order = 0;
    const finish = (b) => {
      const t = clean(b.text);
      if (t && !b.skip && !b.hasChild) out.blocks.push({ tag: b.tag, text: t, inMain: b.inMain, order: b.order });
      if (/^h[1-6]$/.test(b.tag)) out.headings.push({ level: Number(b.tag[1]), text: t, inMain: b.inMain });
      else if (b.tag === "p" && t) out.paragraphs.push({ text: t, inMain: b.inMain });
      else if (b.tag === "blockquote" && t) out.blockquotes.push(t);
    };
    const closeOpen = (tag) => {
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].tag === tag) finish(blocks.splice(i, 1)[0]);
    };
    let m;
    while (m = re.exec(html)) {
      if (m[0].startsWith("<!--")) continue;
      if (m[1]) {
        const raw = m[1].toLowerCase();
        if (raw === "script") {
          out.scripts++;
          out.scriptBytes += m[3].length;
          const a = parseAttrs(m[2]);
          if ((a.type || "").toLowerCase().includes("ld+json")) {
            const body = m[3].trim();
            try {
              out.jsonld.push(JSON.parse(body));
            } catch (e) {
              out.jsonldErrors.push(String(e.message).slice(0, 120));
            }
          }
        }
        continue;
      }
      if (m[5]) {
        const tag = m[5].toLowerCase();
        const closing = m[4] === "/";
        if (!closing) {
          const a = parseAttrs(m[6] || "");
          if (tag === "html" && a.lang) out.lang = a.lang;
          if (tag === "meta") {
            const key = (a.name || a.property || a["http-equiv"] || a.itemprop || "").toLowerCase();
            if (key && a.content !== void 0) out.meta[key] = a.content;
            if (a.charset) out.meta.charset = a.charset;
          }
          if (tag === "link") out.links.push(a);
          if (tag === "title") {
            titleOpen = true;
            titleText = "";
          }
          if (tag === "ul" || tag === "ol") out.lists++;
          if (tag === "table") out.tables++;
          if (tag === "time") out.times.push(a.datetime || "");
          if (tag === "div" && /^(root|app|__next|__nuxt|svelte)$/i.test(a.id || "")) out.rootDivs++;
          if (tag === "main" || tag === "article") {
            out.hasMain = true;
            mainDepth++;
          }
          if (SKIP_TEXT.has(tag)) skipDepth++;
          if (tag === "a") anchor = { href: a.href || "", rel: a.rel || "", text: "" };
          if (tag === "br" || !INLINE.has(tag)) for (const b of blocks) b.text += " ";
          if (CLOSES_P.has(tag)) closeOpen("p");
          if (tag === "li") closeOpen("li");
          if (BLOCK.has(tag)) {
            for (const open of blocks) open.hasChild = true;
            blocks.push({ tag, text: "", attrs: a, order: order++, skip: skipDepth > 0, inMain: mainDepth > 0 || tag === "main" || tag === "article" });
          }
          if (!VOID.has(tag)) stack.push(tag);
        } else {
          if (tag === "title" && titleOpen) {
            titleOpen = false;
            out.title = clean(titleText);
          }
          if (tag === "a" && anchor) {
            anchor.text = clean(anchor.text);
            out.anchors.push(anchor);
            anchor = null;
          }
          if (!INLINE.has(tag)) for (const b of blocks) b.text += " ";
          if (BLOCK.has(tag)) {
            for (let i = blocks.length - 1; i >= 0; i--) {
              if (blocks[i].tag === tag) {
                finish(blocks.splice(i, 1)[0]);
                break;
              }
            }
          } else if (!INLINE.has(tag)) {
            closeOpen("p");
          }
          if (SKIP_TEXT.has(tag) && skipDepth) skipDepth--;
          if ((tag === "main" || tag === "article") && mainDepth) mainDepth--;
          const idx = stack.lastIndexOf(tag);
          if (idx >= 0) stack.length = idx;
        }
        continue;
      }
      const text = m[7] ?? (m[0] === "<" ? "<" : "");
      if (!text) continue;
      if (titleOpen) {
        titleText += text;
        continue;
      }
      if (anchor) anchor.text += text;
      for (const b of blocks) b.text += text;
      if (!skipDepth) {
        textAll.push(text);
        if (mainDepth) textMain.push(text);
      }
    }
    for (const b of blocks.splice(0)) finish(b);
    out.blocks.sort((a, b) => a.order - b.order);
    out.text = clean(textAll.join(" "));
    out.mainText = clean(textMain.join(" "));
    return out;
  }
  function jsonldNodes(docs) {
    const nodes = [];
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if (v["@graph"]) walk(v["@graph"]);
      if (v["@type"]) nodes.push(v);
    };
    docs.forEach(walk);
    return nodes;
  }
  var typesOf = (node) => [].concat(node["@type"] || []).map(String);

  // src/robots.mjs
  var AI_BOTS = [
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
    { ua: "CCBot", owner: "Common Crawl", role: "training", product: "Common Crawl, used by many models" }
  ];
  function parseRobots(text) {
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
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
          groups.push(current);
        }
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
  function isAllowed(robots, ua, path) {
    const name = ua.toLowerCase();
    let group = robots.groups.find((g) => g.agents.includes(name));
    if (!group) group = robots.groups.find((g) => g.agents.includes("*"));
    if (!group) return { allowed: true, group: null, rule: null };
    let best = null;
    for (const r of group.rules) {
      if (!ruleMatches(r.path, path)) continue;
      const len = r.path.replace(/\*/g, "").length;
      if (!best || len > best.len || len === best.len && r.allow && !best.rule.allow) best = { rule: r, len };
    }
    return { allowed: best ? best.rule.allow : true, group: group.agents.includes(name) ? name : "*", rule: best?.rule ?? null };
  }

  // src/checks.mjs
  var C = (id, category, title, weight, why) => ({ id, category, title, weight, why });
  var CATEGORIES = {
    access: { label: "Can AI reach it?", blurb: "If an AI crawler can't fetch or read the page, nothing else matters." },
    structure: { label: "Can AI understand it?", blurb: "Clear structure tells a model what the page is, who it's for and how it's organised." },
    quotability: { label: "Is it worth quoting?", blurb: "Engines lift short, specific, sourced passages. Vague pages get skipped." },
    trust: { label: "Can AI trust it?", blurb: "Authorship, dates and sources decide whether a page is safe to cite." }
  };
  var AUTHORITY = /(^|\.)(gov|edu|mil|int)(\.[a-z]{2})?$|(^|\.)(ac|gov|gob|gouv)\.[a-z]{2}$|(^|\.)(wikipedia\.org|doi\.org|arxiv\.org|nih\.gov|who\.int|europa\.eu|oecd\.org|worldbank\.org|imf\.org|un\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|wiley\.com|jstor\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|nber\.org|ieee\.org|acm\.org|reuters\.com|apnews\.com|bbc\.co\.uk|bbc\.com|ft\.com|economist\.com|statista\.com|pewresearch\.org|gartner\.com|mckinsey\.com|github\.com|w3\.org|ietf\.org|developer\.mozilla\.org)$/i;
  var STAT = /(?:[$€£¥₹]\s?\d[\d,.\s]*\d?\s?(?:k|m|bn|million|billion)?)|(?:\b\d[\d,.]*\s?(?:%|percent\b|per cent\b|pp\b|x\b|times\b|million\b|billion\b|thousand\b|users\b|customers\b|hours?\b|days?\b|minutes?\b|seconds?\b|ms\b|kg\b|km\b|GB\b|MB\b|USD\b|EUR\b|MAD\b|GBP\b|dirhams?\b))/gi;
  var QUESTION = /\?\s*$|^(how|what|why|when|where|which|who|can|does|do|is|are|should|will|comment|pourquoi|quand|quel|quelle|est-ce)\b/i;
  var ABOUT = /about|contact|team|our-story|company|à-propos|a-propos|qui-sommes|equipe|من-نحن|اتصل/i;
  function hostOf(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
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
  function pageChecks(page, fetchInfo) {
    const out = [];
    const add = (def, status, evidence, fix) => out.push({ ...def, status, evidence, fix });
    const url = fetchInfo.finalUrl;
    const nodes = jsonldNodes(page.jsonld);
    const types = nodes.flatMap(typesOf);
    const body = page.hasMain && wordCount(page.mainText) > 80 ? page.mainText : page.text;
    const words2 = wordCount(body);
    const robotsMeta = `${page.meta.robots || ""},${page.meta.googlebot || ""},${fetchInfo.headers?.get?.("x-robots-tag") || ""}`.toLowerCase();
    const indexDef = C("indexable", "access", "Page is allowed in search and AI answers", 10, "A noindex or nosnippet directive tells engines not to show or quote the page.");
    if (/noindex|\bnone\b/.test(robotsMeta)) add(indexDef, "fail", `Robots directive: "${robotsMeta.replace(/^,+|,+$/g, "")}"`, "Remove noindex from the meta robots tag or X-Robots-Tag header.");
    else if (/nosnippet|max-snippet\s*:\s*0\b/.test(robotsMeta)) add(indexDef, "fail", `Snippets are blocked: "${robotsMeta.replace(/^,+|,+$/g, "")}"`, "Remove nosnippet / max-snippet:0. Google's AI Overviews and others cannot quote a page that forbids snippets.");
    else add(indexDef, "pass", "No noindex or nosnippet directives.", "");
    const renderDef = C("server-rendered", "access", "Content is in the HTML, not only in JavaScript", 12, "Most AI crawlers do not run JavaScript. If the text only appears after scripts run, they see an empty page.");
    const spaSigns = page.rootDivs > 0 || page.scriptBytes > 6e4;
    if (words2 < 120 && spaSigns) add(renderDef, "fail", `Only ${words2} words reach a crawler, and the page looks like a JavaScript app (${page.rootDivs ? "app root element" : `${Math.round(page.scriptBytes / 1024)} KB of inline script`}).`, "Server-render or pre-render this page (SSR/SSG), so the text is in the HTML response.");
    else if (words2 < 120) add(renderDef, "warn", `Only ${words2} words of text in the HTML.`, "Add real content to the page, or make sure it is rendered on the server.");
    else add(renderDef, "pass", `${words2.toLocaleString("en")} words of text in the HTML response.`, "");
    const speedDef = C("response-time", "access", "Responds quickly", 4, "Crawlers fetch pages live while answering; slow pages get dropped.");
    if (fetchInfo.ms > 5e3) add(speedDef, "fail", `HTML took ${(fetchInfo.ms / 1e3).toFixed(1)} s.`, "Cache the HTML at the edge or speed up the server; aim for under 1.5 s.");
    else if (fetchInfo.ms > 2e3) add(speedDef, "warn", `HTML took ${(fetchInfo.ms / 1e3).toFixed(1)} s.`, "Aim for under 1.5 s for the HTML response.");
    else add(speedDef, "pass", fetchInfo.ms ? `HTML in ${fetchInfo.ms} ms.` : "Local file.", "");
    const titleDef = C("title", "structure", "Clear page title", 4, "The title is the first thing a model reads to decide what the page answers.");
    const tl = page.title.length;
    if (!tl) add(titleDef, "fail", "No <title>.", "Add a <title> that says what the page answers, in 30\u201360 characters.");
    else if (tl < 15 || tl > 70) add(titleDef, "warn", `"${page.title}" (${tl} characters).`, "Keep the title between 15 and 70 characters and lead with the topic.");
    else add(titleDef, "pass", `"${page.title}"`, "");
    const descDef = C("description", "structure", "Meta description summarises the page", 3, "Engines use it as a ready-made summary of what the page offers.");
    const d = page.meta.description || page.meta["og:description"] || "";
    if (!d) add(descDef, "fail", "No meta description.", "Add a 120\u2013160 character description that states the answer or offer plainly.");
    else if (d.length < 50 || d.length > 200) add(descDef, "warn", `${d.length} characters: "${d.slice(0, 90)}${d.length > 90 ? "\u2026" : ""}"`, "Aim for 50\u2013160 characters.");
    else add(descDef, "pass", `"${d.slice(0, 110)}${d.length > 110 ? "\u2026" : ""}"`, "");
    const hDef = C("headings", "structure", "One H1 and a clear outline", 5, "Headings are how models split a page into answerable sections.");
    const h1 = page.headings.filter((h) => h.level === 1);
    const h2 = page.headings.filter((h) => h.level === 2);
    if (h1.length === 0) add(hDef, "fail", "No H1.", "Add one H1 that names the topic of the page.");
    else if (h1.length > 1) add(hDef, "warn", `${h1.length} H1s: ${h1.slice(0, 3).map((h) => `"${h.text.slice(0, 40)}"`).join(", ")}`, "Use exactly one H1; turn the others into H2s.");
    else if (words2 > 600 && h2.length < 2) add(hDef, "warn", `One H1, but only ${h2.length} H2 for ${words2} words.`, "Break long content into H2 sections, one question or idea each.");
    else add(hDef, "pass", `H1 "${h1[0].text.slice(0, 60)}", ${h2.length} H2 sections.`, "");
    const ldDef = C("structured-data", "structure", "Structured data (JSON-LD) describes the page", 8, "Schema.org markup states facts \u2014 who, what, when, price, rating \u2014 in a form machines read without guessing.");
    if (page.jsonldErrors.length) add(ldDef, "fail", `JSON-LD that doesn't parse: ${page.jsonldErrors[0]}`, 'Fix the JSON syntax in the <script type="application/ld+json"> block; invalid markup is ignored.');
    else if (!nodes.length) add(ldDef, "fail", "No JSON-LD found.", "Add Organization (or Person) and an Article, Product, FAQPage or WebPage block. `getcited --fix` drafts one.");
    else {
      const useful = types.filter((t) => /Article|BlogPosting|NewsArticle|Product|FAQPage|HowTo|LocalBusiness|Organization|Person|Service|Recipe|Event|Course|SoftwareApplication|Review|QAPage|WebPage|Dataset/.test(t));
      add(ldDef, useful.length ? "pass" : "warn", `Types: ${[...new Set(types)].join(", ")}`, useful.length ? "" : "Add a specific type (Article, Product, FAQPage, Organization\u2026) rather than only generic nodes.");
    }
    const entDef = C("entity", "structure", "Brand is defined as an entity", 4, "sameAs links tie your brand to profiles models already know (LinkedIn, Wikipedia, Crunchbase\u2026).");
    const org = nodes.find((n) => typesOf(n).some((t) => /Organization|LocalBusiness|Person|Corporation/.test(t)));
    if (!org) add(entDef, "warn", "No Organization or Person node.", "Add an Organization (or Person) node with name, url, logo and sameAs links to your official profiles.");
    else {
      const same = [].concat(org.sameAs || []);
      add(entDef, same.length >= 2 ? "pass" : "warn", `${typesOf(org)[0]} "${org.name || "(no name)"}" with ${same.length} sameAs link${same.length === 1 ? "" : "s"}.`, same.length >= 2 ? "" : "Add sameAs links to at least two official profiles (LinkedIn, Wikipedia, Crunchbase, GitHub, X\u2026).");
    }
    const langDef = C("lang", "structure", "Language is declared", 2, "Lets engines match the page to questions asked in that language.");
    add(langDef, page.lang ? "pass" : "warn", page.lang ? `lang="${page.lang}"` : "No lang attribute on <html>.", page.lang ? "" : 'Add lang="en" (or your language) to the <html> tag.');
    const canDef = C("canonical", "structure", "Canonical URL", 2, "Stops duplicate versions of a page splitting its authority.");
    const canonical = page.links.find((l) => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"));
    if (!canonical) add(canDef, "warn", "No canonical link.", `Add <link rel="canonical" href="${url}">.`);
    else add(canDef, "pass", canonical.href, "");
    const pool = page.paragraphs.filter((p) => wordCount(p.text) >= 8);
    const firstMain = pool.find((p) => p.inMain) || pool[0];
    const afDef = C("answer-first", "quotability", "Answers up front", 10, "Engines quote short, self-contained passages. If the answer is buried in paragraph four, another page gets quoted.");
    if (!firstMain) add(afDef, "fail", "No paragraph text found.", "Open with a 1\u20133 sentence paragraph that directly answers the page's main question.");
    else {
      const w = wordCount(firstMain.text);
      const sample = `"${firstMain.text.slice(0, 140)}${firstMain.text.length > 140 ? "\u2026" : ""}"`;
      if (w > 110) add(afDef, "warn", `The opening paragraph is ${w} words: ${sample}`, "Put a 40\u201380 word direct answer first; move background after it.");
      else add(afDef, "pass", `Opening paragraph is ${w} words: ${sample}`, "");
    }
    const statDef = C("statistics", "quotability", "Specific numbers and statistics", 8, "In the GEO study (KDD 2024), adding statistics was one of the strongest ways to increase visibility in AI answers.");
    const stats = (body.match(STAT) || []).filter((s) => !/^(19|20)\d{2}$/.test(s.trim()));
    const per1k = words2 ? stats.length / words2 * 1e3 : 0;
    if (words2 < 120) add(statDef, "info", "Not enough text to judge.", "");
    else if (per1k >= 4) add(statDef, "pass", `${stats.length} figures (${per1k.toFixed(1)} per 1,000 words), e.g. ${stats.slice(0, 3).map((s) => `"${s.trim()}"`).join(", ")}.`, "");
    else if (stats.length) add(statDef, "warn", `${stats.length} figure${stats.length === 1 ? "" : "s"} in ${words2} words (${per1k.toFixed(1)} per 1,000).`, "Add concrete, sourced numbers: prices, results, time saved, market sizes. Never invent them.");
    else add(statDef, "fail", `No figures in ${words2} words.`, "Add concrete, sourced numbers. Specific claims get quoted; vague ones don't.");
    const citeDef = C("citations", "quotability", "Cites authoritative sources", 7, "Pages that link their claims to primary sources were cited markedly more often in the GEO study.");
    const host = hostOf(url);
    const outbound = page.anchors.filter((a) => /^https?:/i.test(a.href) && hostOf(a.href) && hostOf(a.href) !== host);
    const authoritative = [...new Set(outbound.map((a) => hostOf(a.href)).filter((h) => AUTHORITY.test(h)))];
    if (words2 < 120) add(citeDef, "info", "Not enough text to judge.", "");
    else if (authoritative.length >= 2) add(citeDef, "pass", `Links to ${authoritative.slice(0, 4).join(", ")}${authoritative.length > 4 ? "\u2026" : ""}.`, "");
    else if (outbound.length) add(citeDef, "warn", `${outbound.length} outbound link${outbound.length === 1 ? "" : "s"}, ${authoritative.length} to recognised authorities.`, "Back key claims with links to primary sources: official statistics, research, standards bodies.");
    else add(citeDef, "fail", "No outbound links to sources.", "Link each key claim to its primary source.");
    const quoteDef = C("quotations", "quotability", "Quotes from people or experts", 4, "Attributed quotations were another top-performing signal in the GEO study.");
    const quoted = (body.match(/[“"][^"”]{25,300}[”"]\s*[,.—-]?\s*(said|says|writes|wrote|explains|according to|—)/gi) || []).length + page.blockquotes.length;
    if (words2 < 120) add(quoteDef, "info", "Not enough text to judge.", "");
    else add(quoteDef, quoted ? "pass" : "warn", quoted ? `${quoted} attributed quotation${quoted === 1 ? "" : "s"}.` : "No attributed quotations.", quoted ? "" : "Add one or two real quotes from named experts, customers or your own team, with attribution.");
    const fmtDef = C("extractable", "quotability", "Lists, tables or Q&A that are easy to lift", 5, "Bullets, tables and question headings map directly onto how answers are written.");
    const qHeads = page.headings.filter((h) => h.level > 1 && QUESTION.test(h.text));
    const hasFaq = types.some((t) => /FAQPage|QAPage/.test(t));
    const fmtScore = (page.lists > 0) + (page.tables > 0) + (qHeads.length > 0 || hasFaq);
    if (words2 < 120) add(fmtDef, "info", "Not enough text to judge.", "");
    else add(
      fmtDef,
      fmtScore >= 2 ? "pass" : fmtScore === 1 ? "warn" : "fail",
      `${page.lists} list${page.lists === 1 ? "" : "s"}, ${page.tables} table${page.tables === 1 ? "" : "s"}, ${qHeads.length} question heading${qHeads.length === 1 ? "" : "s"}${hasFaq ? ", FAQ markup" : ""}.`,
      fmtScore >= 2 ? "" : "Turn key facts into a list or table, and phrase some H2s as the questions customers actually ask."
    );
    const depthDef = C("depth", "quotability", "Enough substance to answer from", 4, "Thin pages rarely contain a quotable answer.");
    if (words2 >= 500) add(depthDef, "pass", `${words2.toLocaleString("en")} words.`, "");
    else if (words2 >= 250) add(depthDef, "warn", `${words2} words.`, "Expand with specifics: who it's for, how it works, costs, examples, FAQs.");
    else add(depthDef, "fail", `${words2} words.`, "A page needs real substance (usually 500+ words) to be a source an engine can quote.");
    const authDef = C("author", "trust", "Named author or publisher", 5, "Engines prefer content with a clear, accountable source.");
    const ldAuthor = nodes.map((n) => n.author).find(Boolean);
    const authorName = ldAuthor ? [].concat(ldAuthor).map((a) => typeof a === "string" ? a : a?.name).filter(Boolean).join(", ") : page.meta.author || page.meta["article:author"] || "";
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
  function siteChecks(site) {
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
      add(
        robotsDef,
        blockedSearch.length ? "fail" : "pass",
        blockedSearch.length ? `Blocked for ${path}: ${blockedSearch.map((r) => `${r.ua} (${r.product})`).join("; ")}.` : `All ${rows.filter((r) => r.role !== "training").length} AI search and user crawlers may fetch ${path}.`,
        blockedSearch.length ? `Allow ${blockedSearch.map((r) => r.ua).join(", ")} in robots.txt:
${blockedSearch.map((r) => `User-agent: ${r.ua}
Allow: /`).join("\n\n")}` : "",
        { table: rows.map((r) => ({ bot: r.ua, owner: r.owner, role: r.role, allowed: r.allowed, rule: r.rule ? `${r.rule.allow ? "Allow" : "Disallow"}: ${r.rule.path} (group ${r.group})` : r.group ? `no rule (group ${r.group})` : "no group" })) }
      );
      add(trainDef, "info", blockedTrain.length ? `Blocked: ${blockedTrain.map((r) => r.ua).join(", ")}. That's your call; it keeps you out of training data, not out of AI search.` : "No training crawlers blocked.", "");
    }
    const cdnDef = C("cdn-block", "access", "Your server or CDN lets AI crawlers through", 14, "Firewalls and CDNs (for example Cloudflare's AI-bot blocking) can reject AI crawlers even when robots.txt allows them. This is invisible unless you test with their real user agents.");
    if (site.botProbe) {
      const blocked = site.botProbe.filter((p) => p.blocked);
      if (!site.browserOk) add(cdnDef, "info", `The page itself didn't load for a normal browser (${site.browserStatus}), so bot access wasn't compared.`, "");
      else add(
        cdnDef,
        blocked.length ? "fail" : "pass",
        blocked.length ? `Rejected: ${blocked.map((p) => `${p.bot} \u2192 ${p.status || p.error}${p.challenge ? " (challenge page)" : ""}`).join(", ")}. A normal browser gets ${site.browserStatus}.` : `${site.botProbe.map((p) => `${p.bot} ${p.status}`).join(", ")}: same content as a browser.`,
        blocked.length ? "Allow verified AI search crawlers in your CDN or firewall (in Cloudflare: Security \u2192 Bots, and AI Crawl Control). Keep training bots blocked if you prefer." : ""
      );
    }
    const llmsDef = C("llms-txt", "structure", "llms.txt guide for AI", 2, "A plain-Markdown map of your key pages for AI tools. Low cost; adoption by the big engines is still limited, so it's a small bonus, not a fix.");
    add(llmsDef, site.llms ? "pass" : "warn", site.llms ? `Found /llms.txt (${site.llms.split("\n").length} lines).` : "No /llms.txt.", site.llms ? "" : "Add /llms.txt. `getcited --fix` drafts one from your pages.");
    const smDef = C("sitemap", "access", "Sitemap is published", 3, "Helps crawlers find every page, including new ones.");
    add(smDef, site.sitemap ? "pass" : "warn", site.sitemap ? `Sitemap: ${site.sitemap}` : "No sitemap found in robots.txt or at /sitemap.xml.", site.sitemap ? "" : "Publish /sitemap.xml and reference it in robots.txt with a Sitemap: line.");
    return out;
  }
  function score(checks) {
    const pts = { pass: 1, warn: 0.5, fail: 0 };
    const scored = checks.filter((c) => c.status !== "info" && c.weight > 0);
    const total = scored.reduce((s, c) => s + c.weight, 0);
    const got = scored.reduce((s, c) => s + c.weight * pts[c.status], 0);
    const byCat = {};
    for (const cat of Object.keys(CATEGORIES)) {
      const cs = scored.filter((c) => c.category === cat);
      const t = cs.reduce((s, c) => s + c.weight, 0);
      byCat[cat] = t ? Math.round(cs.reduce((s, c) => s + c.weight * pts[c.status], 0) / t * 100) : null;
    }
    const overall = total ? Math.round(got / total * 100) : 0;
    const grade = overall >= 90 ? "A" : overall >= 75 ? "B" : overall >= 60 ? "C" : overall >= 40 ? "D" : "F";
    return { overall, grade, byCategory: byCat };
  }
  function priorities(checks) {
    return checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => ({ ...c, impact: c.weight * (c.status === "fail" ? 1 : 0.5) })).sort((a, b) => b.impact - a.impact);
  }

  // src/audit.mjs
  function normalizeUrl(input) {
    if (/^https?:\/\//i.test(input) || input.startsWith("file://")) return input;
    return "https://" + input.replace(/^\/+/, "");
  }
  async function auditPage(url, opts) {
    const res = opts.html !== void 0 ? { ok: true, status: 200, url, headers: new Headers(), body: opts.html, ms: 0 } : await get(url);
    if (!res.ok) return { url, error: res.error || `HTTP ${res.status}`, status: res.status };
    const page = readHtml(res.body);
    const checks = pageChecks(page, { status: res.status, ms: res.ms, headers: res.headers, finalUrl: res.url });
    return { url: res.url, status: res.status, ms: res.ms, page, checks, headers: res.headers };
  }
  function sameSiteLinks(page, base, limit) {
    const origin = new URL(base).origin;
    const seen = /* @__PURE__ */ new Set([new URL(base).href.replace(/#.*/, "")]);
    const out = [];
    for (const a of page.anchors) {
      let u;
      try {
        u = new URL(a.href, base);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      u.hash = "";
      if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|css|js|xml|ico)$/i.test(u.pathname)) continue;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      out.push(u.href);
    }
    return out.sort((a, b) => new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length).slice(0, limit);
  }
  async function audit(input, opts = {}) {
    const pages = Math.max(1, opts.pages || 1);
    let url = normalizeUrl(opts.url || input);
    let html;
    if (opts.file) {
      html = await readFile(opts.file, "utf8");
      if (!opts.url) url = pathToFileURL(resolve(opts.file)).href;
    }
    const isRemote = /^https?:/i.test(url) && !opts.file;
    const first = await auditPage(url, { html });
    if (first.error) return { url, error: first.error, status: first.status };
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
        if (sm.ok && /<(urlset|sitemapindex)/i.test(sm.body)) {
          site.sitemap = origin + "/sitemap.xml";
          sitemapUrls = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
        }
      }
      if (opts.probeBots !== false) {
        site.browserOk = first.status >= 200 && first.status < 400;
        site.browserStatus = first.status;
        site.botProbe = await Promise.all(Object.entries(BOT_UAS).map(async ([bot, ua]) => {
          const r = await get(first.url, { ua, timeoutMs: 12e3 });
          const challenge = r.ok && looksBlocked(r);
          return { bot, status: r.status, error: r.error, blocked: !r.ok ? looksBlocked(r) : challenge, challenge };
        }));
      }
    }
    const sChecks = isRemote ? siteChecks(site) : [];
    const results = [first];
    if (pages > 1 && isRemote) {
      const candidates = [.../* @__PURE__ */ new Set([...sameSiteLinks(first.page, first.url, pages * 3), ...sitemapUrls])].slice(0, pages - 1);
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
      auditedAt: (/* @__PURE__ */ new Date()).toISOString(),
      url: first.url,
      site: { checks: sChecks, robotsFound: Boolean(site.robots), llms: Boolean(site.llms), sitemap: site.sitemap || null },
      score: score(allChecks),
      priorities: priorities(allChecks),
      pages: pageReports,
      _pages: results
      // raw facts for --fix (not serialised)
    };
  }
  function summarize(page) {
    return {
      title: page.title,
      description: page.meta.description || page.meta["og:description"] || "",
      h1: page.headings.find((h) => h.level === 1)?.text || "",
      lang: page.lang,
      siteName: page.meta["og:site_name"] || "",
      image: page.meta["og:image"] || ""
    };
  }

  // src/text.mjs
  var STOP = new Set(`a about above after again against all am an and any are as at be because been before being below between both but by can
could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it
its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such
than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which
while who whom why will with would you your yours yourself yourselves get got also may might must shall us via per vs versus using use used much many
le la les un une des du de et ou en dans pour par sur avec est sont que qui ce cette ces au aux il elle ils elles nous vous se sa son ses leur
el los las del y o en para por con es son que un una`.split(/\s+/));
  function sentences(text) {
    const protectedText = String(text).replace(/\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Inc|Ltd|Co|St|No|approx|fig)\./gi, "$1\0").replace(/(\d)\.(\d)/g, "$1\0$2");
    return protectedText.split(/(?<=[.!?…])\s+(?=["“(\[]?[\p{Lu}\p{N}])/u).map((s) => s.replace(/\u0000/g, ".").trim()).filter(Boolean);
  }
  var words = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  // src/xray.mjs
  var FLUFF = /\b(world[- ]class|best[- ]in[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|revolutionary|game[- ]chang\w*|seamless(ly)?|synerg\w+|leverag\w+|innovative|unparalleled|unrivall?ed|next[- ]gen(eration)?|empower\w*|unlock\w*|elevate\w*|supercharg\w+|robust|holistic|disrupt\w*|transform (your|the way)|one[- ]stop|second to none|passionate about|we pride ourselves|look no further|in today'?s (fast[- ]paced|digital) world)\b/gi;
  var HEDGE = /\b(might|perhaps|possibly|arguably|somewhat|we believe|we think|in our opinion|it seems|kind of|sort of)\b/i;
  var CTA = /\b(click here|learn more|read more|sign up|subscribe|get started|book a (demo|call)|contact us|call us|download now|try (it )?(for )?free|buy now|add to cart|follow us)\b/i;
  var DANGLING = /^(it|this|that|these|those|they|he|she|its|their|here|there|such|also|however|but|and|so|which|as (mentioned|noted|discussed))\b/i;
  var CONTEXT = /\b(see|shown|listed|described|mentioned|noted|outlined) (above|below)\b|\b(above|below)\s*[:.]?\s*$|\bas (mentioned|shown|discussed)\b|\bthe following\b|\bsee (the )?(table|chart|image|figure)\b|\bin this (article|post|guide)\b/i;
  var FACT = /\b(is|are|was|were) (a|an|the|one of|about|around|over|under|\d)|\b(costs?|charges?|means|refers to|consists of|includes|contains|requires|takes|lasts|measures|weighs|equals|ranges from|starts at|was founded|is based|is located|launched|released|lets you|allows|enables|works by|happens when|means that)\b/i;
  var SOURCE = /\b(according to|found that|reported|reports that|study|survey|research(ers)?|data from|analysis of|published|census|per the)\b/i;
  var NUMBER = /(\d[\d.,]*\s?(%|percent|x|×|ms|s|kb|mb|gb|km|kg|m|cm|mm|h|hours?|days?|weeks?|months?|years?|users?|customers?|people)?\b)|[$€£¥₹]\s?\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|half|double)\b/i;
  function scoreSentence(s) {
    const n = words(s);
    const plus = [], minus = [];
    let score2 = 40;
    if (n < 5) return { score: 5, plus, minus: ["fragment, too short to quote"], verdict: "dead" };
    if (CTA.test(s)) return { score: 5, plus, minus: ["call to action, not information"], verdict: "dead" };
    if (n >= 8 && n <= 35) {
      score2 += 12;
      plus.push("liftable length");
    } else if (n > 50) {
      score2 -= 18;
      minus.push(`${n} words, too long to lift; split it`);
    } else if (n > 35) {
      score2 -= 6;
      minus.push(`${n} words, a little long`);
    }
    if (NUMBER.test(s)) {
      score2 += 18;
      plus.push("specific number");
    }
    if (FACT.test(s)) {
      score2 += 14;
      plus.push("states a fact directly");
    }
    if (SOURCE.test(s)) {
      score2 += 10;
      plus.push("attributes a source");
    }
    if (/["“][^"”]{12,}["”]/.test(s)) {
      score2 += 6;
      plus.push("contains a quotation");
    }
    if (new RegExp("\\s\\p{Lu}[\\p{L}\\p{N}]+", "u").test(s.slice(1))) {
      score2 += 6;
      plus.push("names a subject");
    }
    if (!DANGLING.test(s) && new RegExp("^(a|an|the)\\s+[\\p{L}\\p{N}]|^\\p{Lu}[\\p{L}\\p{N}]+\\s", "iu").test(s) && !/^(click|get|ask|sell|call|try|read|see|buy|make)\b/i.test(s)) {
      score2 += 6;
      plus.push("opens with its subject");
    }
    if (DANGLING.test(s)) {
      score2 -= 22;
      minus.push(`starts with "${s.split(/\s/)[0]}", so it doesn't stand alone`);
    }
    if (CONTEXT.test(s)) {
      score2 -= 14;
      minus.push("points at context the engine won't carry over");
    }
    const fluff = s.match(FLUFF) || [];
    if (fluff.length) {
      score2 -= Math.min(30, 15 * fluff.length);
      minus.push(`marketing fluff: ${[...new Set(fluff.map((f) => f.toLowerCase()))].join(", ")}`);
    }
    if (HEDGE.test(s)) {
      score2 -= 10;
      minus.push("hedged, engines prefer definite statements");
    }
    if (/\?\s*$/.test(s)) {
      score2 -= 14;
      minus.push("a question, not an answer");
    }
    if (/!\s*$/.test(s)) {
      score2 -= 6;
      minus.push("exclamation reads as promotion");
    }
    score2 = Math.max(0, Math.min(100, score2));
    return { score: score2, plus, minus, verdict: score2 >= 65 ? "quotable" : score2 >= 40 ? "weak" : "dead" };
  }
  function xray(page) {
    const useMain = page.hasMain && page.blocks.some((b) => b.inMain);
    const pool = page.blocks.filter((b) => (useMain ? b.inMain : true) && !["summary", "th", "td"].includes(b.tag));
    const out = [];
    const layout = [];
    pool.forEach((b, bi) => {
      const h = /^h([1-6])$/.exec(b.tag);
      if (h) {
        layout.push({ h: b.text, level: Number(h[1]) });
        return;
      }
      const idx = [];
      for (const s of sentences(b.text)) {
        idx.push(out.length);
        out.push({ block: bi, tag: b.tag, text: s, words: words(s), ...scoreSentence(s) });
      }
      if (idx.length) layout.push({ tag: b.tag, s: idx });
    });
    const total = out.length || 1;
    const q = out.filter((s) => s.verdict === "quotable");
    const dead = out.filter((s) => s.verdict === "dead");
    const allWords = out.reduce((a, s) => a + s.words, 0) || 1;
    const avg = Math.round(out.reduce((a, s) => a + s.score, 0) / total);
    return {
      sentences: out,
      layout,
      summary: {
        sentences: out.length,
        quotable: q.length,
        weak: out.filter((s) => s.verdict === "weak").length,
        dead: dead.length,
        quotableShare: Math.round(q.length / total * 100),
        deadWordShare: Math.round(dead.reduce((a, s) => a + s.words, 0) / allWords * 100),
        perHundredWords: +(q.length / allWords * 100).toFixed(2),
        average: out.length ? avg : 0,
        firstQuotable: out.findIndex((s) => s.verdict === "quotable")
      },
      best: [...out].sort((a, b) => b.score - a.score || a.text.length - b.text.length).slice(0, 5),
      worst: [...out].filter((s) => s.minus.length).sort((a, b) => a.score - b.score).slice(0, 5)
    };
  }

  // src/report.mjs
  var esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  var ICON = { pass: "\u2713", warn: "!", fail: "\u2717", info: "\xB7" };
  function fixHtml(fix) {
    const [head, ...rest] = fix.split("\n");
    return `<p class="f"><b>Fix:</b> ${esc(head)}</p>${rest.length ? `<pre>${esc(rest.join("\n").trim())}</pre>` : ""}`;
  }
  function toHtml(report) {
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
      return `<section><header><h2>${esc(CATEGORIES[cat].label)}</h2><span class="cat ${v >= 75 ? "pass" : v >= 50 ? "warn" : "fail"}">${v ?? "\u2013"}</span></header><p class="blurb">${esc(CATEGORIES[cat].blurb)}</p><ul>${rows}</ul>
      ${cat === "access" && robotsTable ? `<details><summary>Crawler-by-crawler robots.txt result</summary><table><thead><tr><th>Crawler</th><th>Owner</th><th>Purpose</th><th>Allowed</th><th>Matching rule</th></tr></thead><tbody>${robotsTable.map((r) => `<tr><td>${esc(r.bot)}</td><td>${esc(r.owner)}</td><td>${esc(r.role)}</td><td class="${r.allowed ? "ok" : "no"}">${r.allowed ? "Yes" : "No"}</td><td>${esc(r.rule)}</td></tr>`).join("")}</tbody></table></details>` : ""}</section>`;
    }).join("");
    const prio = report.priorities.slice(0, 5).map((p) => `<li><b>${esc(p.title)}.</b> ${esc(p.fix.split("\n")[0].replace(/:$/, "."))}</li>`).join("");
    const pages = report.pages.length > 1 ? `<section><header><h2>Pages audited</h2></header><table><thead><tr><th>Score</th><th>Page</th></tr></thead><tbody>${report.pages.map((p) => `<tr><td>${p.score.overall}</td><td>${esc(p.url)}</td></tr>`).join("")}</tbody></table></section>` : "";
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>getcited \xB7 ${esc(report.url)}</title>
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
<div class="hero">${ring(s.overall)}<div><h1>${esc(report.url)}</h1><p class="sub">AI citation readiness \xB7 grade ${s.grade} \xB7 ${esc(report.auditedAt.slice(0, 10))}</p>
<div class="cats">${Object.entries(s.byCategory).map(([k, v]) => `<span>${esc(CATEGORIES[k].label)} <b>${v ?? "\u2013"}</b></span>`).join("")}</div></div></div>
${prio ? `<div class="prio"><h2>Fix these first</h2><ol>${prio}</ol></div>` : ""}
${sections}${pages}
<footer>Static checks of what AI crawlers receive. A high score makes you citable; it doesn't guarantee citations. Made with <a href="https://github.com/mohamedsaidyekhlef-png/getcited">getcited</a>.</footer>
</div></body></html>`;
  }
  return __toCommonJS(engine_entry_exports);
})();
