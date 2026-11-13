// Unit tests for Admin > Updates: release comparison, repo validation, safe zip staging, and the sudo-availability messaging —
// all with the network and "sudo" calls faked, since no real GitHub repo or sudoers rule exists to test against here.
//   node plugin-kit/tests/updater.unit.js
const fs = require("fs"), os = require("os"), path = require("path");
const { load, zip, makeCounter } = require("./harness");             // requiring this also installs the express/multer mocks used below
const APP = path.join(__dirname, "..", "..", "app");
const T = makeCounter(), ok = T.ok;
const H = load();                                                     // gives us the mocked express + a scratch tmp dir; unrelated plugin bits are unused here

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vp-upd-"));
process.env.VIBEPRESS_DIR = tmp; process.env.VP_DATA_DIR = path.join(tmp, "app", "data"); process.env.USER = "linuxuser";

const calls = []; let sudoStatus = 1, sudoApplyResult = { status: 0, stdout: "done", stderr: "" };
const fakeRun = (cmd, args) => { calls.push([cmd, ...args]);
  if (cmd === "sudo" && args[1] === "-l") return { status: sudoStatus };
  if (cmd === "sudo") return sudoApplyResult;
  return { status: 1 }; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mod = require(path.join(APP, "updater.js"))({ page: (t, b) => b, h1: t => t, esc, hidden: () => "", verifyCsrf: (q, s, n) => n(), run: fakeRun });
const call = (method, p, body) => H.call(mod.admin, method, p, { body: body || {} });

(async () => {
  console.log("\n-- repository setting --");
  let r = await call("POST", "/repo", { repo: "nope nope" }); ok("a repo name that is not owner/name is refused", r.code === 400 && /owner\/repository/.test(r.body), r.body.slice(0, 150));
  r = await call("POST", "/repo", { repo: "tdsas27/vibepress" }); ok("a valid owner/name is saved", r.code === 200, r.body.slice(0, 100));
  r = await call("GET", "/"); ok("the saved repo shows on the page", r.body.includes("tdsas27/vibepress"));

  console.log("\n-- the fixed sudoers line --");
  ok("the suggested sudoers line names the exact, single staged script path", mod._sudoLine().includes(mod._target()) && mod._sudoLine().includes("NOPASSWD"), mod._sudoLine());
  sudoStatus = 1; ok("without the sudoers rule, sudoReady() is false", mod._sudoReady() === false);
  sudoStatus = 0; ok("once sudo -n -l succeeds for that exact command, sudoReady() is true", mod._sudoReady() === true);
  ok("the readiness check names the staged script, not a wildcard", calls.some(c => c[0] === "sudo" && c[3] === "bash" && c[4] === mod._target()));

  console.log("\n-- safely staging a release zip --");
  const GOOD = { "update.sh": "#!/bin/bash\necho hi", "VERSION": "9.9.9\n", "app/package.json": JSON.stringify({ name: "vibepress", version: "9.9.9" }) };
  const mkzip = files => { const p = path.join(tmp, "z" + Math.random().toString(16).slice(2) + ".zip"); fs.writeFileSync(p, zip(Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) })))); return p; };
  let v = mod._stageZip(mkzip(GOOD)); ok("a well-formed release is staged and its version read back", v === "9.9.9" && fs.existsSync(mod._target()));
  v = mod._stageZip(mkzip(Object.fromEntries(Object.entries(GOOD).map(([k, d]) => ["vibepress-9.9.9/" + k, d])))); ok("one wrapping folder (as GitHub zips always add) is handled", v === "9.9.9" && fs.existsSync(mod._target()));
  const bad = (name, files, re) => { try { mod._stageZip(mkzip(files)); ok(name, false, "did not throw"); } catch (e) { ok(name, re.test(e.message), e.message); } };
  bad("a zip missing update.sh is refused", { "VERSION": "1.0.0", "app/package.json": "{}" }, /does not look like a VibePress release/);
  bad("a zip with a path-traversal entry is refused", Object.assign({}, GOOD, { "../evil.sh": "x" }), /unsafe path/);
  bad("a zip with an absolute path entry is refused", Object.assign({}, GOOD, { "/etc/evil": "x" }), /unsafe path/);
  bad("a zip whose own version is not a plain number is refused", Object.assign({}, GOOD, { "app/package.json": JSON.stringify({ version: "not-a-version" }) }), /version number could not be read/);
  fs.writeFileSync(path.join(tmp, "notazip.zip"), "hello"); try { mod._stageZip(path.join(tmp, "notazip.zip")); ok("a non-zip file is refused", false); } catch (e) { ok("a non-zip file is refused", /not a valid zip/.test(e.message), e.message); }

  console.log("\n-- checking and applying (network and sudo both faked) --");
  mod._stageZip(mkzip(GOOD));
  sudoStatus = 1; r = await call("POST", "/apply"); ok("without the sudoers rule, Apply refuses and explains, instead of trying and failing silently", r.code === 400 && /not set up/.test(r.body), r.body.slice(0, 200));
  sudoStatus = 0; r = await call("POST", "/apply"); ok("with the sudoers rule in place, Apply runs the staged script via sudo -n and nothing else", r.code === 200 && calls.some(c => c.join(" ") === "sudo -n bash " + mod._target()), JSON.stringify(calls.slice(-3)));
  sudoApplyResult = { status: 1, stdout: "", stderr: "npm install failed" }; r = await call("POST", "/apply"); ok("a failed update shows the real output, not a false success", /npm install failed/.test(r.body) && /did not finish/.test(r.body), r.body.slice(0, 300));
  fs.rmSync(mod._target(), { force: true }); fs.rmSync(path.dirname(mod._target()), { recursive: true, force: true }); r = await call("POST", "/apply"); ok("Apply with nothing staged says so, rather than running stale files", r.code === 400 && /Nothing is staged/.test(r.body));

  console.log("\n-- version comparison --");
  const { cmp } = require(path.join(APP, "plugins", "manifest"));
  ok("cmp treats equal versions as equal", cmp("1.2.3", "1.2.3") === 0);
  ok("cmp says 1.2.3 is older than 1.3.0", cmp("1.2.3", "1.3.0") < 0);
  ok("cmp says 2.0.0 is newer than 1.9.9", cmp("2.0.0", "1.9.9") > 0);

  fs.rmSync(tmp, { recursive: true, force: true }); process.exit(T.done());
})().catch(e => { console.error("CRASH", e); process.exit(1); });
