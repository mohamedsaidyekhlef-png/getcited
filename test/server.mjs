// Tiny test server. `good` serves a well-built page; `bad` serves an SPA shell and,
// like a CDN with AI-bot blocking on, answers AI crawler user agents with a 403 challenge.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const recent = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);

export function serve(kind) {
  return new Promise((resolveServe) => {
    const srv = createServer((req, res) => {
      const origin = `http://${req.headers.host}`;
      const ua = req.headers["user-agent"] || "";
      if (kind === "bad" && /GPTBot|OAI-SearchBot|ClaudeBot|PerplexityBot/.test(ua) && req.url === "/") {
        res.writeHead(403, { "content-type": "text/html" });
        return res.end("<html><title>Just a moment...</title><body>cf-chl-bypass</body></html>");
      }
      const name = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
      const file = join(root, kind, name);
      if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }
      let body = readFileSync(file, "utf8").replaceAll("__ORIGIN__", origin).replaceAll("__RECENT__", recent);
      if (kind === "bad" && name === "index.html") body = body.replace("PADDING", "x".repeat(70000));
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".xml") ? "application/xml" : "text/plain";
      res.writeHead(200, { "content-type": type });
      res.end(body);
    });
    srv.listen(0, "127.0.0.1", () => resolveServe({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}
