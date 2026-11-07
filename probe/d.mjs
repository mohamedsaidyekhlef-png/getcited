import { simulate } from "../src/simulate.mjs";
const passage = `Selling a structured settlement costs the discount: the gap between what your future payments are worth and the lump sum a buyer pays you. Buyers apply a discount rate, often between 9% and 15%, and on a $100,000 payment stream that can mean $20,000 or more.

Between a 9% and a 15% rate, one seller would lose $38,678. As a rule of thumb, a rate under 10% is strong, 10% to 13% is fair, and 14% or more is unfavorable.

Offers may also include fees, so ask for the rate, every fee and the net amount in writing. Every sale needs a judge's approval, and most sales take 45 to 90 days.`;
const comps = ["https://peachtreefinancial.com/how-much-does-it-cost-to-sell-a-structured-settlement", "https://www.annuity.org/structured-settlements/selling/", "https://www.ramseysolutions.com/saving/structured-settlement", "https://www.consumersadvocate.org/structured-settlements/how-much-does-selling-a-structured-settlement-cost", "https://gainbridge.com/post/selling-a-structured-settlement"];
const r = await simulate({ question: "How much does it cost to sell a structured settlement?", mine: "https://www.settlementdecisions.com/", competitors: comps, passage, k: 12 });
for (const [n, a] of [["before", r.before], ["after", r.after]]) {
  console.log("D", n, JSON.stringify(a.standings.map((s) => [s.label, +s.share.toFixed(2), s.bestRank])));
  console.log("D", n, "ctx", JSON.stringify(a.context.map((p) => [p.rank, p.source, (p.heading || "").slice(-50), p.words, +(p.quality || 0).toFixed(2)])));
}
