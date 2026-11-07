// Builds dist/engine.js and getcited-extension.zip. Needs esbuild (npx esbuild) and zip.
// Usage: node integrations/browser-extension/build.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
const stub = here + "src/stubs/node.mjs";
execFileSync("npx", ["--yes", "esbuild@0.25.12", here + "src/engine-entry.mjs", "--bundle", "--format=iife", "--global-name=getcited", "--platform=browser", "--target=chrome116,firefox128",
  ...["node:fs/promises", "node:url", "node:path", "node:fs"].map((m) => `--alias:${m}=${stub}`), "--outfile=" + here + "dist/engine.js", "--log-level=warning"], { stdio: "inherit" });
execFileSync("bash", ["-c", `cd "${here}" && rm -f getcited-extension.zip && zip -qr getcited-extension.zip manifest.json popup.html popup.css popup.js dist icons`], { stdio: "inherit" });
console.log("built dist/engine.js and getcited-extension.zip");
