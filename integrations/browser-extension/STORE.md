# Store listing: getcited for Chrome, Edge and Firefox

Upload `getcited-extension.zip` (built by `node integrations/browser-extension/build.mjs`) to:
- Chrome Web Store developer dashboard: https://chrome.google.com/webstore/devconsole (one-time $5 developer fee)
- Microsoft Edge Add-ons (Partner Center): https://partner.microsoft.com/dashboard/microsoftedge (same zip)
- Firefox Add-ons: https://addons.mozilla.org/developers/ (same zip; the manifest carries `browser_specific_settings.gecko`)

## Listing
**Name:** getcited: AI Search Visibility
**Summary (132 chars max):** Can ChatGPT, Perplexity and Google AI Overviews reach, read and quote this page? Audit and sentence X-ray in one click.
**Category:** Developer Tools (secondary idea: Productivity)
**Language:** English

**Description:**
getcited checks whether AI answer engines (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews) can cite the page you're on.

Click the icon on any page and get:
• A 0–100 AI citation readiness score in four parts: can AI reach it, understand it, quote it and trust it
• AI crawler access from robots.txt (OAI-SearchBot, Claude-SearchBot, PerplexityBot and more) and llms.txt
• Whether the content is in the HTML or only appears after JavaScript runs (most AI crawlers don't run JavaScript)
• Structured data, answer-first writing, statistics, sources, authorship and freshness checks
• A sentence X-ray: what share of the page an AI would actually quote, and the sentence to rewrite first
• The full report in a new tab, with the exact fix for every failing check

Free and open source (MIT): https://github.com/mohamedsaidyekhlef-png/getcited
The same engine runs as a CLI, a GitHub Action that fails a pull request when a change would cost you an AI citation, and an MCP server for Claude, ChatGPT and Cursor.

**Assets:** icons/icon-128.png · store/screenshot-1280x800.png · store/promo-tile-440x280.png

## Privacy practices (dashboard answers)
**Single purpose:** Audit the current web page for AI search visibility.
**activeTab:** reads the address of the tab the user is on when they open the popup.
**Optional host permission (requested per site, only when the user clicks "Audit this page"):** fetches that site's page, robots.txt and llms.txt the way an AI crawler would.
**Remote code:** none. All code ships in the package.
**Data collection:** none. Nothing is sent to getcited or SCAIROS; requests go only to the site being audited. No analytics, no accounts.
**Privacy policy URL:** https://www.scairos.com/getcited/privacy
