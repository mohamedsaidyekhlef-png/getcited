// A small, tolerant HTML reader. It is not a full parser: it extracts exactly
// what a GEO audit needs (meta, headings, paragraphs, links, JSON-LD, visible
// text) from the HTML a crawler receives, without running any JavaScript.

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®",
  trade: "™", laquo: "«", raquo: "»", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
  middot: "·", bull: "•", euro: "€", pound: "£", deg: "°", times: "×",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, " ").trim();
export const wordCount = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

const BLOCK = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote", "figcaption", "dt", "dd", "summary"]);
const SKIP_TEXT = new Set(["nav", "footer", "header", "aside", "form", "button", "select", "label"]);
// Tags that implicitly end an open <p> (HTML's "p auto-close" rule, simplified).
const CLOSES_P = new Set(["p", "div", "ul", "ol", "table", "section", "main", "article", "header", "footer", "nav", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "form", "figure", "hr", "dl", "details", "address", "fieldset"]);
const INLINE = new Set(["a", "b", "i", "em", "strong", "span", "code", "small", "sup", "sub", "abbr", "mark", "u", "s", "q", "cite", "time", "kbd", "br", "img", "label"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Parse an HTML document into the facts the audit uses. */
export function readHtml(html) {
  const out = {
    lang: "", title: "", meta: {}, links: [], anchors: [], headings: [], paragraphs: [],
    lists: 0, tables: 0, blockquotes: [], jsonld: [], jsonldErrors: [], times: [],
    scripts: 0, scriptBytes: 0, text: "", mainText: "", hasMain: false, rootDivs: 0,
  };
  const re = /<!--[\s\S]*?-->|<(script|style|noscript|template|svg)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>|([^<]+)|</g;
  const stack = [];
  const blocks = []; // open block collectors {tag, text, attrs}
  let anchor = null;
  let textAll = [], textMain = [], skipDepth = 0, mainDepth = 0, titleOpen = false, titleText = "";
  const finish = (b) => {
    const t = clean(b.text);
    if (/^h[1-6]$/.test(b.tag)) out.headings.push({ level: Number(b.tag[1]), text: t, inMain: b.inMain });
    else if (b.tag === "p" && t) out.paragraphs.push({ text: t, inMain: b.inMain });
    else if (b.tag === "blockquote" && t) out.blockquotes.push(t);
  };
  const closeOpen = (tag) => {
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].tag === tag) finish(blocks.splice(i, 1)[0]);
  };
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const raw = m[1].toLowerCase();
      if (raw === "script") {
        out.scripts++;
        out.scriptBytes += m[3].length;
        const a = parseAttrs(m[2]);
        if ((a.type || "").toLowerCase().includes("ld+json")) {
          const body = m[3].trim();
          try { out.jsonld.push(JSON.parse(body)); } catch (e) { out.jsonldErrors.push(String(e.message).slice(0, 120)); }
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
          if (key && a.content !== undefined) out.meta[key] = a.content;
          if (a.charset) out.meta.charset = a.charset;
        }
        if (tag === "link") out.links.push(a);
        if (tag === "title") { titleOpen = true; titleText = ""; }
        if (tag === "ul" || tag === "ol") out.lists++;
        if (tag === "table") out.tables++;
        if (tag === "time") out.times.push(a.datetime || "");
        if (tag === "div" && /^(root|app|__next|__nuxt|svelte)$/i.test(a.id || "")) out.rootDivs++;
        if (tag === "main" || tag === "article") { out.hasMain = true; mainDepth++; }
        if (SKIP_TEXT.has(tag)) skipDepth++;
        if (tag === "a") anchor = { href: a.href || "", rel: a.rel || "", text: "" };
        if (CLOSES_P.has(tag)) closeOpen("p");
        if (tag === "li") closeOpen("li");
        if (BLOCK.has(tag)) blocks.push({ tag, text: "", attrs: a, inMain: mainDepth > 0 || tag === "main" || tag === "article" });
        if (!VOID.has(tag)) stack.push(tag);
      } else {
        if (tag === "title" && titleOpen) { titleOpen = false; out.title = clean(titleText); }
        if (tag === "a" && anchor) { anchor.text = clean(anchor.text); out.anchors.push(anchor); anchor = null; }
        if (BLOCK.has(tag)) {
          for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].tag === tag) { finish(blocks.splice(i, 1)[0]); break; }
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
    if (titleOpen) { titleText += text; continue; }
    if (anchor) anchor.text += text;
    for (const b of blocks) b.text += text;
    if (!skipDepth) {
      textAll.push(text);
      if (mainDepth) textMain.push(text);
    }
  }
  // Unclosed blocks at end of document are legal HTML; flush them.
  for (const b of blocks.splice(0)) finish(b);
  out.text = clean(textAll.join(" "));
  out.mainText = clean(textMain.join(" "));
  return out;
}

/** Flatten JSON-LD (arrays, @graph) into a list of typed nodes. */
export function jsonldNodes(docs) {
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

export const typesOf = (node) => [].concat(node["@type"] || []).map(String);
