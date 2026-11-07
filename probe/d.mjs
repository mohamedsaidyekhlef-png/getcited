import { simulate } from "../src/simulate.mjs";
import { simulateCard, simulateMarkdown } from "../src/present.mjs";
const passage = `Selling a structured settlement costs the discount: the gap between what your future payments are worth and the lump sum a buyer pays you. On a $100,000 payment stream that can mean $20,000 or more.

### The discount rate: the main cost of selling a structured settlement
Buyers apply a discount rate, often between 9% and 15%. Between a 9% and a 15% rate, one seller would lose $38,678. Under 10% is strong, 10% to 13% is fair, and 14% or more is unfavorable.

### Fees and court costs when you sell a structured settlement
Offers may include fees, so get the rate, every fee and the net amount in writing. Every sale needs a judge's approval, and most sales take 45 to 90 days.`;
const comps = ["https://peachtreefinancial.com/how-much-does-it-cost-to-sell-a-structured-settlement", "https://www.annuity.org/structured-settlements/selling/", "https://www.ramseysolutions.com/saving/structured-settlement", "https://www.consumersadvocate.org/structured-settlements/how-much-does-selling-a-structured-settlement-cost", "https://gainbridge.com/post/selling-a-structured-settlement"];
const r = await simulate({ question: "How much does it cost to sell a structured settlement?", mine: "https://www.settlementdecisions.com/", competitors: comps, passage });
const c = simulateCard(r);
console.log("SIM\n" + simulateMarkdown(c));
console.log("CARD " + Buffer.from(JSON.stringify(c)).toString("base64"));
