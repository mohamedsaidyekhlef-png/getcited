// A stand-in for an LLM API, speaking both the OpenAI chat-completions and the
// Anthropic messages wire formats, so live mode is tested end to end offline.
import { createServer } from "node:http";

function reply(prompt) {
  if (prompt.includes("Ground-truth facts")) {
    return 'Here you go:\n```json\n[{"s":1,"verdict":"correct","fact":"F1","why":"matches"},{"s":2,"verdict":"wrong","fact":"F2","why":"it is Austin, not Miami"},{"s":3,"verdict":"unverifiable"}]\n```';
  }
  if (prompt.startsWith("What do you know about")) {
    return '["CashNow Settlements was founded in 2018.", "CashNow is headquartered in Miami, Florida.", "CashNow buys structured settlement payments."]';
  }
  if (prompt.includes("Sources:")) {
    // Cite every source that mentions a discount rate, the way a model cites the passages it uses.
    const cited = [...prompt.matchAll(/^\[(\d+)\] ([^\n]*)/gm)].filter((m) => /discount rate/i.test(m[2])).map((m) => m[1]);
    return `A buyout costs the gap between the payments' value and the lump sum ${cited.map((n) => `[${n}]`).join("")}. Rates vary by buyer [${cited[0] || 1}].`;
  }
  return "I don't know.";
}

export function mockLlm() {
  const calls = [];
  return new Promise((done) => {
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const j = JSON.parse(body || "{}");
        calls.push({ path: req.url, headers: req.headers, body: j });
        res.setHeader("content-type", "application/json");
        if (req.url.endsWith("/chat/completions")) {
          if (req.headers.authorization !== "Bearer test-key") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "bad key" } })); }
          const prompt = j.messages.at(-1).content;
          return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply(prompt) } }] }));
        }
        if (req.url.endsWith("/messages")) {
          if (req.headers["x-api-key"] !== "test-key") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "bad key" } })); }
          return res.end(JSON.stringify({ content: [{ type: "text", text: reply(j.messages[0].content) }] }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    srv.listen(0, "127.0.0.1", () => done({ base: `http://127.0.0.1:${srv.address().port}/v1`, calls, close: () => srv.close() }));
  });
}
