// AI lie detector: what does a model say about your brand when nobody gives it
// sources, and how much of it is true? Asks the model closed-book (the way
// models answer when they don't search), then checks every claim against the
// facts you supply. Wrong claims are what you need to publish more clearly.

import { complete, extractJson } from "./llm.mjs";

export async function truth({ brand, site, facts, llm, judge }) {
  if (!brand) throw new Error("truth needs a brand name");
  if (!facts?.length) throw new Error("truth needs at least one fact to check against (facts: in getcited.yml, or --fact)");
  if (!llm) throw new Error("truth needs a model: --model provider:model (see getcited --help)");
  const ask = `What do you know about ${brand}${site ? ` (${site})` : ""}? Reply with a JSON array of 6 to 10 short, specific factual statements about it: what it is, who founded or runs it, when and where it started, what it offers, what it costs, who uses it. Only include what you believe is true. If you don't know it, reply with [].`;
  const reply = await complete(llm, { system: "You answer from your own knowledge, without browsing.", prompt: ask, temperature: 0.2 });
  let claims = extractJson(reply);
  if (!Array.isArray(claims)) claims = reply.split(/\n+/).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 12);
  claims = claims.map((c) => (typeof c === "string" ? c : c?.statement || c?.claim || JSON.stringify(c))).filter(Boolean).slice(0, 12);
  if (!claims.length) return { tool: "getcited", brand, model: llm.label, known: false, claims: [], accuracy: null, summary: `${llm.label} says it doesn't know ${brand}. That's a visibility gap, not a lie: the model has nothing to cite.` };

  const judgeCfg = judge || llm;
  const jprompt = `Ground-truth facts about ${brand}:\n${facts.map((f, i) => `F${i + 1}. ${f}`).join("\n")}\n\nStatements an AI made about ${brand}:\n${claims.map((c, i) => `S${i + 1}. ${c}`).join("\n")}\n\nFor each statement, decide:\n- "correct": the facts support it\n- "wrong": it contradicts a fact (name the fact)\n- "unverifiable": the facts don't say\nReply with only a JSON array: [{"s": 1, "verdict": "correct|wrong|unverifiable", "fact": "F2", "why": "short reason"}]`;
  const jreply = await complete(judgeCfg, { system: "You are a strict fact checker. Judge only against the given facts.", prompt: jprompt, temperature: 0 });
  const verdicts = extractJson(jreply);
  const rows = claims.map((c, i) => {
    const v = Array.isArray(verdicts) ? verdicts.find((x) => Number(String(x.s).replace(/\D/g, "")) === i + 1) : null;
    const verdict = ["correct", "wrong", "unverifiable"].includes(v?.verdict) ? v.verdict : "unverifiable";
    const fi = v?.fact ? Number(String(v.fact).replace(/\D/g, "")) - 1 : -1;
    return { claim: c, verdict, fact: facts[fi] || null, why: v?.why || "" };
  });
  const correct = rows.filter((r) => r.verdict === "correct").length;
  const wrong = rows.filter((r) => r.verdict === "wrong");
  const checked = correct + wrong.length;
  const accuracy = checked ? +(correct / checked).toFixed(3) : null;
  const unmentioned = facts.filter((f) => !rows.some((r) => r.fact === f));
  return {
    tool: "getcited", brand, model: llm.label, judge: judgeCfg.label, known: true,
    accuracy, correct, wrong: wrong.length, unverifiable: rows.length - checked,
    claims: rows,
    fixes: [
      ...wrong.map((r) => `AI says "${r.claim.replace(/[.]$/, "")}". The truth: "${r.fact || "see your facts"}". State it in one plain sentence on your About page and in Organization JSON-LD, so engines that search find the right answer.`),
      ...(unmentioned.length ? [`The model never mentioned: ${unmentioned.map((f) => `"${f}"`).join("; ")}. If these matter to buyers, make them easy to quote.`] : []),
    ],
    summary: accuracy === null ? `${llm.label} said ${rows.length} things about ${brand}; none could be checked against your facts.` : `${llm.label} is ${Math.round(accuracy * 100)}% right about ${brand}: ${correct} correct, ${wrong.length} wrong, ${rows.length - checked} unverifiable.`,
  };
}
