import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "probe", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://getcited.scairos.com/mcp")));
console.log("R tools " + (await c.listTools()).tools.map((t) => t.name).join(","));
const t0 = Date.now();
const r = await c.callTool({ name: "getcited_site", arguments: { domain: "annuity.org", competitors: ["jgwentworth.com", "peachtreefinancial.com", "settlementdecisions.com", "nerdwallet.com"] } });
console.log("R ms " + (Date.now() - t0));
console.log("R " + r.content[0].text.replace(/\n/g, "\nR "));
