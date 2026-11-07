# getcited integrations

Every integration runs the same engine in `src/`. None of them reimplements the audit, X-ray or arena.

| Integration | Where | Status |
|---|---|---|
| CLI | `npx github:mohamedsaidyekhlef-png/getcited` | Live |
| GitHub Action | `uses: mohamedsaidyekhlef-png/getcited@v1` ([action.yml](../action.yml)) | Live |
| Agent skill | `npx skills add mohamedsaidyekhlef-png/getcited` ([SKILL.md](../SKILL.md)) | Live |
| Local MCP server | `npx -y github:mohamedsaidyekhlef-png/getcited mcp` | Live |
| Remote MCP server | `https://www.scairos.com/api/getcited/mcp` (Streamable HTTP, no key) | Live |
| JSON API | `POST https://www.scairos.com/api/getcited/v1/{audit,xray,arena}` | Live |
| Browser extension (Chrome, Edge, Firefox) | [browser-extension/](browser-extension/) | Built; store review pending |

The hosted endpoints run `src/remote.mjs`. It refuses private network addresses, including on every redirect hop, caps the work per call, rate-limits each client and never accepts model keys. The truth check needs your own key, so it runs locally only.
