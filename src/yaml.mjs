// A small YAML reader for getcited.yml: block maps, block lists, inline [a, b]
// lists, quoted and plain scalars, numbers, booleans and comments. It is not a
// full YAML implementation (no anchors, multi-docs or block scalars), and says
// so with a line number when it meets something it doesn't support.

function scalar(raw, line) {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v[0] === '"') {
    try { return JSON.parse(v); } catch { throw new Error(`getcited.yml line ${line}: bad double-quoted string`); }
  }
  if (v[0] === "'") {
    if (!v.endsWith("'")) throw new Error(`getcited.yml line ${line}: unclosed quote`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v[0] === "[" && v.endsWith("]")) return splitInline(v.slice(1, -1)).map((x) => scalar(x, line));
  if (v[0] === "{" || v[0] === "|" || v[0] === ">" || v[0] === "&" || v[0] === "*") throw new Error(`getcited.yml line ${line}: "${v[0]}" syntax isn't supported; use plain block maps and lists`);
  return v;
}

function splitInline(s) {
  const out = [];
  let cur = "", q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ",") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { if (i === 0 || /[\s:[,-]/.test(s[i - 1])) q = ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

export function parseYaml(src) {
  const lines = [];
  String(src).replace(/^﻿/, "").split(/\r?\n/).forEach((l, i) => {
    if (/\t/.test(l.match(/^\s*/)[0])) throw new Error(`getcited.yml line ${i + 1}: use spaces, not tabs, for indentation`);
    const body = stripComment(l).replace(/\s+$/, "");
    if (!body.trim() || body.trim() === "---") return;
    lines.push({ indent: body.match(/^ */)[0].length, text: body.trim(), n: i + 1 });
  });
  let pos = 0;

  function block(indent) {
    const first = lines[pos];
    if (!first || first.indent < indent) return null;
    return first.text.startsWith("- ") || first.text === "-" ? list(first.indent) : map(first.indent);
  }

  function keyValue(text, n) {
    const m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(text);
    if (!m) throw new Error(`getcited.yml line ${n}: expected "key: value"`);
    return [String(scalar(m[1], n)), m[2]];
  }

  function map(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith("- ")) {
      const { text, n } = lines[pos++];
      const [k, v] = keyValue(text, n);
      if (v === undefined || v === "") obj[k] = lines[pos] && lines[pos].indent > indent ? block(lines[pos].indent) : lines[pos] && lines[pos].indent === indent && lines[pos].text.startsWith("- ") ? list(indent) : null;
      else obj[k] = scalar(v, n);
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new Error(`getcited.yml line ${lines[pos].n}: unexpected indentation`);
    return obj;
  }

  function list(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].text.startsWith("- ") || lines[pos].text === "-")) {
      const { text, n } = lines[pos];
      const rest = text === "-" ? "" : text.slice(2).trim();
      if (!rest) { pos++; arr.push(block(indent + 1)); continue; }
      if (/^("[^"]*"|'[^']*'|[^:"'[\]{}]+?)\s*:(\s|$)/.test(rest) && !/^https?:\/\//.test(rest)) {
        // "- key: value" starts a map whose other keys are indented to the key column.
        const col = indent + 2 + (text.slice(2).length - text.slice(2).trimStart().length);
        lines[pos] = { indent: col, text: rest, n };
        arr.push(map(col));
      } else {
        pos++;
        arr.push(scalar(rest, n));
      }
    }
    return arr;
  }

  const out = block(0);
  if (pos < lines.length) throw new Error(`getcited.yml line ${lines[pos].n}: unexpected content`);
  return out ?? {};
}
