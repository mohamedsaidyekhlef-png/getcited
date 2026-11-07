import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "probe", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://getcited.scairos.com/mcp")));
console.log("TOOLS " + (await c.listTools()).tools.map((t) => t.name).join(","));
const passage = `Selling a structured settlement costs the discount: the gap between what your future payments are worth and the lump sum a buyer pays you. Buyers apply a discount rate, often between 9% and 15%, and on a $100,000 payment stream that can mean $20,000 or more.

Between a 9% and a 15% rate, one seller would lose $38,678. As a rule of thumb, a rate under 10% is strong, 10% to 13% is fair, and 14% or more is unfavorable.

Offers may also include fees, so ask for the rate, every fee and the net amount in writing. Every sale needs a judge's approval, and most sales take 45 to 90 days.`;
const r = await c.callTool({ name: "getcited_simulate", arguments: { question: "How much does it cost to sell a structured settlement?", mine: "https://www.settlementdecisions.com/", competitors: ["https://peachtreefinancial.com/how-much-does-it-cost-to-sell-a-structured-settlement", "https://www.annuity.org/structured-settlements/selling/", "https://www.ramseysolutions.com/saving/structured-settlement", "https://www.consumersadvocate.org/structured-settlements/how-much-does-selling-a-structured-settlement-cost", "https://gainbridge.com/post/selling-a-structured-settlement"], passage } });
console.log("SIM\n" + r.content[0].text);
console.log("CARD " + Buffer.from(JSON.stringify(r.structuredContent)).toString("base64"));
const f = await c.callTool({ name: "getcited_fixkit", arguments: { url: "https://www.settlementdecisions.com/" } });
console.log("FIX\n" + f.content[0].text.slice(0, 2500));
console.log("FCARD " + Buffer.from(JSON.stringify(f.structuredContent)).toString("base64"));
