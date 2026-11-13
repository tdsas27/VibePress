#!/usr/bin/env node
/* VibePress plugin kit.
     node vp-plugin.js check <folder>      checks a plugin folder the same way the admin does when it is installed
     node vp-plugin.js pack  <folder>      checks it, then makes <id>-<version>.vpplugin ready to upload or share
     node vp-plugin.js new   <id>          makes a starter plugin folder you can edit (or hand to an AI) */
const fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");
const zip = require("./zip"), { inspectDir } = require("../app/plugins/package"), { describePerm } = require("../app/plugins/manifest");
const [cmd, arg] = process.argv.slice(2);
const say = (...a) => console.log(...a), die = m => { console.error("\n" + m + "\n"); process.exit(1); };

function report(dir) {
  const r = inspectDir(path.resolve(dir), undefined);
  if (r.manifest) say(`\n${r.manifest.name || "(no name)"} ${r.manifest.version || ""}  [${r.manifest.id || "?"}]`);
  if (r.manifest && r.manifest.permissions.length) { say("Asks permission to:"); r.manifest.permissions.forEach(p => say("  - " + describePerm(p))); }
  if (r.manifest && r.manifest.server) say("Has server code (runs in the sandbox; installers are asked to trust it).");
  r.errors.forEach(e => say("  ERROR   " + e));
  r.findings.forEach(f => say(`  ${f.level === "block" ? "BLOCKED" : "warning"} ${f.file}: ${f.msg}`));
  say(r.ok ? `\nOK: ${r.files.length} files, ready to pack.` : "\nNot ready. Fix the lines above and check again.");
  return r;
}

if (cmd === "check" && arg) { process.exit(report(arg).ok ? 0 : 1); }
else if (cmd === "pack" && arg) {
  const r = report(arg); if (!r.ok) process.exit(1);
  const dir = path.resolve(arg), out = path.resolve(`${r.manifest.id}-${r.manifest.version}.vpplugin`);
  const entries = r.files.filter(f => !/\.DS_Store$/.test(f.rel)).sort((a, b) => a.rel.localeCompare(b.rel)).map(f => ({ name: f.rel, data: fs.readFileSync(path.join(dir, f.rel)) }));
  const buf = zip(entries); fs.writeFileSync(out, buf);
  say(`\nWrote ${out}\nFingerprint (SHA-256): ${crypto.createHash("sha256").update(buf).digest("hex")}\nShare the file and the fingerprint; installers can compare it on the review screen.`);
} else if (cmd === "new" && arg) {
  if (!/^[a-z][a-z0-9-]{2,29}$/.test(arg)) die("The id must be 3-30 lowercase letters, digits or hyphens, starting with a letter.");
  const to = path.resolve(arg); if (fs.existsSync(to)) die(`${to} already exists.`);
  fs.cpSync(path.join(__dirname, "examples", "hello-world"), to, { recursive: true });
  const f = path.join(to, "plugin.json"), m = JSON.parse(fs.readFileSync(f, "utf8")); m.id = arg; m.name = arg.replace(/-/g, " ").replace(/^./, c => c.toUpperCase()); m.author = "Your name"; m.description = "Describe what this plugin does."; fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
  say(`\nCreated ${to}\nEdit it (or paste PLUGIN-AI-PROMPT.md into an AI and describe what you want), then:  node vp-plugin.js pack ${arg}`);
} else say("Usage:\n  node vp-plugin.js new <id>\n  node vp-plugin.js check <folder>\n  node vp-plugin.js pack <folder>");
