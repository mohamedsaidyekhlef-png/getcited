import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c = new Client({ name: "probe", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL("https://www.scairos.com/mcp")));
console.log("SERVER", c.getServerVersion().version);
const a = await c.callTool({ name: "getcited_audit", arguments: { url: "https://www.scairos.com/getcited" } });
console.log("CRAWLERS", a.structuredContent.crawlers.map((b) => `${b.bot}:${b.live ? b.live.status : "-"}`).join(" "));
console.log("FIXES", a.structuredContent.priorities.map((p) => `${p.title} +${p.gain} ${p.effort}`).join(" | "));
const w = await c.readResource({ uri: "ui://getcited/report.html" }); console.log("WIDGET", /Fix all with AI/.test(w.contents[0].text));
for (const u of ["https://www.scairos.com/getcited", "https://www.scairos.com/getcited/app/audit-card.png", "https://www.scairos.com/getcited/brand/favicon.ico"]) { const r = await fetch(u); const t = r.headers.get("content-type"); console.log("GET", u, r.status, t, t.includes("html") ? /MCP server live/.test(await r.text()) : ""); }
await c.close();
