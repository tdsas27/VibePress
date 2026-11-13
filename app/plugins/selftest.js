#!/usr/bin/env node
/* Proves the plugin sandbox works on THIS server:  node app/plugins/selftest.js
   It installs the example plugins into a throw-away folder, then installs a deliberately hostile plugin (skipping the install-time scan on
   purpose) and checks that the run-time sandbox stops each attempt. Nothing in your real site or data is touched. */
const fs = require("fs"), os = require("os"), path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vp-selftest-"));
process.env.VP_DATA_DIR = path.join(tmp, "data"); process.env.SITE_DIR = path.join(tmp, "site");
const registry = require("./registry"), host = require("./host"), pdata = require("./pdata"), pkg = require("./package"), { validate } = require("./manifest");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${extra && !cond ? "  -> " + extra : ""}`); };

const EVIL = {
  "plugin.json": JSON.stringify({ id: "evil-test", name: "Evil Test", version: "1.0.0", author: "selftest", description: "Hostile on purpose", vibepress: "0.2.0", server: "server.js" }),
  "server.js": `
module.exports = function (vp) {
  const t = async f => { try { const r = await f(); return "ALLOWED: " + String(r).slice(0, 60); } catch (e) { return "blocked: " + String(e.code || e.message).slice(0, 70); } };
  vp.route("GET", "/attack", async () => ({ json: {
    fs: await t(() => require("fs").readFileSync("/etc/passwd", "utf8")),
    net: await t(() => require("net").connect(80, "1.1.1.1")),
    nodeNet: await t(() => require("node:net")),
    childProcess: await t(() => require("child_process").execSync("id")),
    outsideFile: await t(() => require("../../../../../../etc/passwd")),
    dynamicImport: await t(() => import("node:net")),
    mainModule: await t(() => process.mainModule.require("net")),
    binding: await t(() => process.binding("tcp_wrap")),
    dlopen: await t(() => process.dlopen({ exports: {} }, "/x.node")),
    eval: await t(() => eval("1+1")),
    newFunction: await t(() => new Function("return process")()),
    ctorEscape: await t(() => ({}).constructor.constructor("return process")()),
    fetchGlobal: typeof fetch === "undefined" ? "blocked: no fetch" : "ALLOWED: fetch exists",
    webSocket: typeof WebSocket === "undefined" ? "blocked: no WebSocket" : "ALLOWED: WebSocket exists",
    env: Object.keys(process.env).length ? "ALLOWED: env has " + Object.keys(process.env).join(",") : "blocked: environment is empty",
    pagesNoPermission: await t(() => vp.pages.list()),
    siteNoPermission: await t(() => vp.site.get()),
    fetchNoPermission: await t(() => vp.fetch("https://example.com/")),
    bigValue: await t(() => vp.kv.set("big", "x".repeat(70000))),
    badKey: await t(() => vp.kv.set("../../etc/passwd", 1))
  } }));
  vp.route("GET", "/spin", async () => { while (true) {} });
  vp.route("GET", "/memory", async () => { const a = []; for (;;) a.push(new Array(1e6).fill(1)); });
  vp.route("GET", "/exit", async () => { process.exit(1); });
  vp.route("GET", "/ok", async () => ({ json: { fine: true } }));
};`
};

(async () => {
  console.log("\nVibePress plugin self-test\n");
  console.log("Sandbox available on this server (Node " + process.version + "): " + host.sandboxAvailable() + (host.sandboxAvailable() ? "   options: " + host.sandboxInfo().flags.join(" ") : "   reason: " + host.sandboxInfo().error));
  ok("Node permission model is available", host.sandboxAvailable(), "Server plugins need Node 22.13 or newer.");

  // 1. package opener
  const kit = path.join(__dirname, "..", "..", "plugin-kit", "examples");
  for (const name of ["hello-world", "guestbook", "hit-counter"]) {
    const r = pkg.inspectDir(path.join(kit, name));
    ok(`example "${name}" passes the install check`, r.ok, JSON.stringify(r.errors.concat(r.findings)));
    registry.install({ base: path.join(kit, name), manifest: r.manifest, hash: "x", zipPath: path.join(kit, name, "plugin.json"), granted: r.manifest.permissions });
  }
  ok("static files are published for the web server", fs.existsSync(path.join(process.env.SITE_DIR, "x", "guestbook", "index.html")));
  ok("the server part is NOT published for the web server", !fs.existsSync(path.join(process.env.SITE_DIR, "x", "hit-counter", "server.js")));

  // 2. a normal server plugin works
  if (host.sandboxAvailable()) {
    let a = await host.call("hit-counter", { method: "POST", path: "/hit", query: {}, body: null, visitor: "v1" });
    let b = await host.call("hit-counter", { method: "POST", path: "/hit", query: {}, body: null, visitor: "v1" });
    let c = await host.call("hit-counter", { method: "POST", path: "/hit", query: {}, body: null, visitor: "v2" });
    ok("hit-counter counts once per visitor", a.json.hits === 1 && b.json.hits === 1 && c.json.hits === 2, JSON.stringify([a, b, c]));
    ok("hit-counter's data is stored under its own name", pdata.kv.get("hit-counter", "hits") === 2);
    const nf = await host.call("hit-counter", { method: "GET", path: "/nothing", query: {}, body: null, visitor: "v" });
    ok("unknown route gives 404", nf.status === 404);

    // 3. hostile plugin
    const dir = path.join(tmp, "evil"); fs.mkdirSync(dir, { recursive: true });
    for (const [f, t] of Object.entries(EVIL)) fs.writeFileSync(path.join(dir, f), t);
    const man = validate(JSON.parse(EVIL["plugin.json"])).manifest;
    const scan = pkg.inspectDir(dir);
    ok("install-time scan flags the hostile plugin", !scan.ok && scan.findings.some(f => f.level === "block"));
    registry.install({ base: dir, manifest: man, hash: "x", zipPath: path.join(dir, "plugin.json"), granted: [] });   // bypass the scan on purpose
    const r = (await host.call("evil-test", { method: "GET", path: "/attack", query: {}, body: null, visitor: "v" })).json;
    for (const [k, v] of Object.entries(r)) ok(`hostile attempt "${k}" is stopped`, String(v).startsWith("blocked"), v);
    const spin = await host.call("evil-test", { method: "GET", path: "/spin", query: {}, body: null, visitor: "v" }).then(() => "no error", e => e.message);
    ok("an endless loop is cut off after a few seconds", /too long/.test(spin), spin);
    const fine = await host.call("evil-test", { method: "GET", path: "/ok", query: {}, body: null, visitor: "v" });
    ok("the plugin is restarted and answers again", fine.json && fine.json.fine === true);
    const mem = await host.call("evil-test", { method: "GET", path: "/memory", query: {}, body: null, visitor: "v" }).then(() => "no error", e => e.message);
    ok("a memory hog is stopped", /stopped|too long/.test(mem), mem);
    const ex = await host.call("evil-test", { method: "GET", path: "/exit", query: {}, body: null, visitor: "v" }).then(() => "no error", e => e.message);
    ok("process.exit only stops the plugin's own process", /stopped/.test(ex), ex);
    const after = await host.call("hit-counter", { method: "GET", path: "/count", query: {}, body: null, visitor: "v" });
    ok("other plugins and the site are unaffected", after.json.hits === 2);
    for (const k of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.5", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) ok(`fetch refuses private address ${k}`, host._privateIp(k));
    ok("fetch allows a public address", !host._privateIp("93.184.216.34"));
    const bad = ["../x", "/etc/passwd", "a b", "net:localhost", "net:127.0.0.1", "net:10.0.0.1", "shell", "net:x"];
    ok("manifest rejects unsafe permissions", validate({ id: "abc", name: "n", version: "1.0.0", author: "a", description: "d", vibepress: "0.2.0", pages: [{ title: "t", path: "index.html" }], permissions: bad }).errors.length === bad.length);
  }
  host.stopAll(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed.\n`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); host.stopAll(); process.exit(1); });
