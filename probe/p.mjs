import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "probe", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://getcited.scairos.com/mcp"), { requestInit: { headers: { Authorization: "Bearer gc_test" } } }));
const t = await c.listTools(); console.log("R tools", t.tools.map((x) => x.name).join(","));
const r = await c.callTool({ name: "getcited_audit", arguments: { url: "settlementdecisions.com" } });
console.log("R audit", r.isError, r.content[0].text.split("\n").slice(0, 3).join(" / "));
