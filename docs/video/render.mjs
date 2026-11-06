// Renders each pillar explainer to MP4: deterministic frames from film.html,
// piped as JPEG straight into ffmpeg (no frame files on disk).
// Usage: node docs/video/render.mjs [scene...]   (needs Playwright + ffmpeg)
import { spawn } from "node:child_process";
import { renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(process.env.PLAYWRIGHT_PATH); }
const here = fileURLToPath(new URL(".", import.meta.url));
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ["arena", "xray", "tests", "regress", "truth", "audit"];
const FPS = 30;
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
for (const scene of scenes) {
  await page.goto(`file://${here}film.html?scene=${scene}`);
  await page.evaluate(() => document.fonts.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const tmp = `${here}${scene}.tmp.mp4`, out = `${here}getcited-${scene}.mp4`;
  const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  for (let f = 0; f < dur * FPS; f++) {
    await page.evaluate((t) => window.renderAt(t), f / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  renameSync(tmp, out);
  console.log("rendered", out);
}
await browser.close();
