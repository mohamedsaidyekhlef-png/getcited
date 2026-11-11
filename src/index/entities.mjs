// Brand mentions in an answer: where each tracked brand first appears, how often, and
// its rank when the answer is a list. Also proposes untracked names worth tracking.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** List items as [start, end) offsets: lines starting with -, *, •, or "1." / "1)". */
function listItems(text) {
  const items = [];
  const re = /^[ \t]*(?:[-*•]|\d{1,2}[.)])[ \t]+.+$/gm;
  for (const m of text.matchAll(re)) items.push([m.index, m.index + m[0].length]);
  return items;
}

export function compileBrands(brands) {
  return brands.map((b) => {
    const names = [b.name, ...(b.aliases || [])].filter(Boolean);
    if (b.domain) names.push(b.domain);
    const alt = names.sort((a, c) => c.length - a.length).map(esc).join("|");
    return { name: b.name, re: new RegExp(`(?<![\\w.])(?:${alt})(?![\\w])`, "gi") };
  });
}

export function mentions(text, compiled) {
  const items = listItems(text);
  const out = [];
  for (const b of compiled) {
    b.re.lastIndex = 0;
    let first = -1, count = 0;
    for (const m of text.matchAll(b.re)) { if (first < 0) first = m.index; count++; }
    if (first < 0) continue;
    const li = items.findIndex(([s, e]) => first >= s && first < e);
    out.push({ brand: b.name, firstOffset: first, listRank: li >= 0 ? li + 1 : null, count });
  }
  return out.sort((a, b) => a.firstOffset - b.firstOffset);
}

const STOP = new Set(["The", "This", "These", "That", "When", "What", "How", "Why", "If", "In", "On", "For", "With", "And", "But", "Or", "You", "Your", "It", "Its", "A", "An", "Some", "Most", "Many", "Each", "Pros", "Cons", "Note", "Overall", "Summary", "Key", "Best", "Top", "Step", "However", "Also", "Yes", "No"]);

/** Proper names that lead list items or are bolded: candidates to add as tracked brands. */
export function discover(text, known = []) {
  const k = new Set(known.map((s) => s.toLowerCase()));
  const found = new Map();
  const add = (n) => {
    n = n.replace(/[:\-–—,.]+$/, "").trim();
    if (n.length < 3 || n.split(" ").length > 5 || STOP.has(n.split(" ")[0]) || k.has(n.toLowerCase())) return;
    found.set(n, (found.get(n) || 0) + 1);
  };
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) if (/^[A-Z0-9]/.test(m[1])) add(m[1]);
  for (const m of text.matchAll(/^[ \t]*(?:[-*•]|\d{1,2}[.)])[ \t]+(?:\*\*)?([A-Z][\w&.'-]*(?:[ \t]+[A-Z][\w&.'-]*){0,4})/gm)) add(m[1]);
  return [...found].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}
