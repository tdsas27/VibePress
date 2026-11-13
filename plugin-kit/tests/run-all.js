#!/usr/bin/env node
// Runs every plugin test in turn and prints one summary:   node plugin-kit/tests/run-all.js
const { spawnSync } = require("child_process"), path = require("path");
const T = [["Maintenance mode: message, Nginx include, guard, preview, auto-reopen, installer steps", "maintenance.unit.js"], ["Site name: admin page, live name, escaping", "sitename.unit.js"], ["Shared header/footer: real browser (back link, credit)", "sitechrome.e2e.js"], ["Address checks", "validators.unit.js"], ["Crypto Downloads: payment logic", "crypto-downloads.unit.js"], ["Plugin system: install, collections, sandbox, hostile packages", "plugins.e2e.js"],
  ["Crypto Downloads: shop, files, settings, downloads", "crypto-downloads.e2e.js"], ["Sandbox self-test (hostile plugin)", path.join("..", "..", "app", "plugins", "selftest.js")], ["Guestbook: real-browser submit (sandbox CSP + reserved-name regression)", "guestbook.e2e.js"], ["Admin > Updates: GitHub release check, safe staging, disclosed sudo apply", "updater.unit.js"], ["Theme: header banner image (upload safety + render-site injection)", "banner.unit.js"], ["Theme page forms: real browser (Save banner / Save theme submit the right form)", "themeforms.e2e.js"]];
// To test other Node.js versions too, list their programs:  VP_EXTRA_NODES=/path/to/node24,/path/to/node20 node plugin-kit/tests/run-all.js
const nodes = [process.execPath].concat((process.env.VP_EXTRA_NODES || "").split(",").map(s => s.trim()).filter(Boolean));
let bad = 0;
for (const node of nodes) for (const [name, file] of T) {
  const ver = spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim();
  process.stdout.write(`[Node ${ver}] ${name} ... `);
  const r = spawnSync(node, [path.join(__dirname, file)], { encoding: "utf8", timeout: 300000 });
  const last = (r.stdout.trim().split("\n").filter(l => /passed/.test(l)).pop() || "no result").trim();
  console.log(r.status === 0 ? "OK   " + last : "FAILED   " + last);
  if (r.status !== 0) { bad++; console.log(r.stdout.split("\n").filter(l => /FAIL|CRASH/.test(l)).slice(0, 8).join("\n") + (r.stderr ? "\n" + r.stderr.slice(0, 400) : "")); }
}
console.log(bad ? `\n${bad} suite(s) failed.\n` : "\nAll plugin tests passed.\n"); process.exit(bad ? 1 : 0);
