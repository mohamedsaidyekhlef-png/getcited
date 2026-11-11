import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "probe", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://getcited.scairos.com/mcp")));
console.log("R tools " + (await c.listTools()).tools.map((t) => t.name).join(","));
const a = await c.callTool({ name: "getcited_audit", arguments: { url: "settlementdecisions.com" } });
console.log("R audit " + a.content[0].text.split("\n").slice(0, 2).join(" / "));
