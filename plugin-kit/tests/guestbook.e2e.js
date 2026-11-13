#!/usr/bin/env node
// Starts the real guestbook server and drives it with a real Chromium browser (via Playwright) to prove the Sign-the-guestbook
// button actually works end to end: node plugin-kit/tests/guestbook.e2e.js
// Requires Python 3 with the "playwright" package and its Chromium browser installed; skips cleanly if that is not available.
const { spawn, spawnSync } = require("child_process"), path = require("path");
const port = 8000 + Math.floor(Math.random() * 1000);
const pyCheck = spawnSync("python3", ["-c", "import playwright.sync_api"], { stdio: "ignore" });
if (pyCheck.status !== 0) { console.log("Skipped: this environment has no Python Playwright install, so the real-browser guestbook test cannot run here.\n0 passed, 0 failed.\n"); process.exit(0); }
const server = spawn(process.execPath, [path.join(__dirname, "browser", "guestbook.server.js")], { env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"] });
let out = "";
server.stdout.on("data", d => out += d); server.stderr.on("data", d => out += d);
const waitReady = () => new Promise((resolve, reject) => {
  const t0 = Date.now(); const tick = () => { if (out.includes("READY")) return resolve(); if (Date.now() - t0 > 15000) return reject(new Error("server did not start: " + out.slice(0, 500))); setTimeout(tick, 200); }; tick();
});
(async () => {
  try { await waitReady(); } catch (e) { console.error(e.message); process.exit(1); }
  const r = spawnSync("python3", [path.join(__dirname, "browser", "guestbook.browser.py"), String(port)], { encoding: "utf8", timeout: 60000 });
  console.log(r.stdout); if (r.stderr) console.error(r.stderr);
  server.kill("SIGTERM");
  let summary = { passed: 0, failed: 1 }; try { summary = JSON.parse(r.stdout.trim().split("\n").pop()); } catch {}
  console.log(`\n${summary.passed} passed, ${summary.failed} failed.\n`);
  process.exit(r.status === 0 ? 0 : 1);
})();
