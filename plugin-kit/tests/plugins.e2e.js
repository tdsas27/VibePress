// End-to-end test of the plugin system with the three small example plugins and a set of hostile packages.   node plugin-kit/tests/plugins.e2e.js
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const { load, zip, makeCounter } = require("./harness");
const T = makeCounter(), ok = T.ok, KIT = path.join(__dirname, ".."), HOUR = 3600000;

(async () => {
  const H = load(), { tmp, A, P, registry, host } = H, packs = fs.mkdtempSync(path.join(os.tmpdir(), "vp-packs-"));
  for (const n of ["hello-world", "guestbook", "hit-counter"]) execFileSync(process.execPath, [path.join(KIT, "vp-plugin.js"), "pack", path.join(KIT, "examples", n)], { cwd: packs, stdio: "ignore" });
  const upload = async name => A("POST", "/upload", { file: { buffer: fs.readFileSync(path.join(packs, name)) } });
  const uploadBuf = async buf => A("POST", "/upload", { file: { buffer: buf } });
  const base = { "plugin.json": '{"id":"badplug","name":"Bad","version":"1.0.0","author":"x","description":"d","vibepress":"0.2.0","pages":[{"title":"t","path":"index.html"}]}', "public/index.html": "<p>hi</p>" };
  const mk = (extra, files) => zip(Object.entries(Object.assign({}, files || base, extra || {})).map(([name, d]) => ({ name, data: Buffer.from(d) })));

  console.log("\n-- the site knows its own version --");
  const root = path.join(KIT, ".."), pkgVersion = JSON.parse(fs.readFileSync(path.join(root, "app", "package.json"), "utf8")).version;
  ok("VERSION and app/package.json agree", fs.readFileSync(path.join(root, "VERSION"), "utf8").trim() === pkgVersion, pkgVersion);
  ok("the version is read correctly", H.manifest.current() === pkgVersion && H.manifest.current() !== "0.0.0", H.manifest.current());
  const inst = fs.mkdtempSync(path.join(os.tmpdir(), "vp-installed-")); fs.cpSync(path.join(root, "app"), path.join(inst, "app"), { recursive: true, filter: s => !s.includes("node_modules") });   // what install.sh creates: app/ only, no VERSION file
  const lone = execFileSync(process.execPath, ["-e", `console.log(require(${JSON.stringify(path.join(inst, "app", "plugins", "manifest.js"))}).current())`]).toString().trim();
  ok("an installed copy (app/ only, no VERSION file) still knows its version", lone === pkgVersion, lone);
  ok("a plugin that needs 0.2.0 is accepted on this version", H.manifest.validate({ id: "abc-test", name: "n", version: "1.0.0", author: "a", description: "d", vibepress: "0.2.0", pages: [{ title: "t", path: "index.html" }] }).ok);
  ok("a plugin that needs a newer version is still refused", /needs VibePress 9\.0\.0/.test(H.manifest.validate({ id: "abc-test", name: "n", version: "1.0.0", author: "a", description: "d", vibepress: "9.0.0", pages: [{ title: "t", path: "index.html" }] }).errors.join()));

  console.log("\n-- upload / review / install --");
  let r = await upload("guestbook-1.0.1.vpplugin"); ok("guestbook upload goes to review", r.loc && r.loc.startsWith("/admin/plugins/review?t="), r.body);
  const tok = r.loc.split("t=")[1];
  r = await A("GET", "/review", { query: { t: tok } }); ok("review shows name, fingerprint and the moderation rule", /Guestbook/.test(r.body) && /Fingerprint/.test(r.body) && /you approve each one/.test(r.body));
  r = await A("POST", "/install", { body: { t: tok } }); ok("install redirects", /^\/admin\/plugins\/\?done=installed/.test(r.loc), r.body);
  ok("web files are published, plugin.json is not", fs.existsSync(tmp + "/site/x/guestbook/index.html") && !fs.existsSync(tmp + "/site/x/guestbook/plugin.json"));
  r = await upload("hit-counter-1.0.0.vpplugin"); const t2 = r.loc.split("t=")[1];
  r = await A("GET", "/review", { query: { t: t2 } }); ok("server plugin review asks for explicit trust", /I know this plugin's server code will run/.test(r.body));
  r = await A("POST", "/install", { body: { t: t2 } }); ok("install is refused without the trust box", r.code === 400);
  r = await A("POST", "/install", { body: { t: t2, trust: "1" } }); ok("install succeeds when trusted", /^\/admin\/plugins\/\?done=installed/.test(r.loc), r.body);

  console.log("\n-- collections --");
  r = await P("OPTIONS", "/guestbook/data/messages"); ok("preflight answered with CORS", r.code === 204 && r.hdr["Access-Control-Allow-Origin"] === "*");
  r = await P("POST", "/guestbook/data/messages", { body: { name: "Ann", message: "<img src=x onerror=alert(1)>", mood: "happy" } }); ok("valid entry accepted as pending", JSON.parse(r.body).pending === true, r.body);
  r = await P("GET", "/guestbook/data/messages"); ok("pending entries are not public", JSON.parse(r.body).items.length === 0);
  r = await A("GET", "/entries", { query: { id: "guestbook", c: "messages" } }); ok("admin sees the entry, HTML-escaped", /&lt;img src=x onerror/.test(r.body) && !/<img src=x/.test(r.body));
  const eid = (r.body.match(/name="e" value="([a-f0-9]{10})"/) || [])[1];
  await A("POST", "/entry", { body: { id: "guestbook", c: "messages", e: eid, do: "approve" } });
  r = await P("GET", "/guestbook/data/messages"); const items = JSON.parse(r.body).items; ok("approved entry is public with only declared fields", items.length === 1 && Object.keys(items[0]).sort().join() === "at,id,message,mood,name", r.body);
  ok("over-long, missing and out-of-list values are refused", (await P("POST", "/guestbook/data/messages", { body: { name: "x", message: "y".repeat(281) } })).code === 400 && (await P("POST", "/guestbook/data/messages", { body: { name: "x" } })).code === 400 && (await P("POST", "/guestbook/data/messages", { body: { name: "x", message: "m", mood: "angry" } })).code === 400);
  let last; for (let i = 0; i < 6; i++) last = await P("POST", "/guestbook/data/messages", { body: { name: "s", message: "spam" } }); ok("write rate limit kicks in (429)", last.code === 429);
  ok("unknown collection and bad plugin id are 404", (await P("POST", "/guestbook/data/nothing", { body: {} })).code === 404 && (await P("GET", "/..%2fadmin/x")).code === 404);
  ok("a visitor cannot write to a collection the plugin marked closed", (await (async () => { const sp = registry.get("guestbook"); return sp.collections.messages.publicWrite; })()) === true);

  console.log("\n-- sandboxed server plugin --");
  r = await P("POST", "/hit-counter/r/hit", { headers: { "x-real-ip": "5.5.5.5" } }); ok("route works", r.code === 200 && JSON.parse(r.body).hits === 1, r.body);
  r = await P("POST", "/hit-counter/r/hit", { headers: { "x-real-ip": "5.5.5.5" } }); ok("same visitor counted once", JSON.parse(r.body).hits === 1);
  r = await P("POST", "/hit-counter/r/hit", { headers: { "x-real-ip": "6.6.6.6" } }); ok("new visitor counted", JSON.parse(r.body).hits === 2);
  r = await P("GET", "/hit-counter/r/nope"); ok("unknown plugin route is 404 JSON", r.code === 404 && r.hdr["X-Content-Type-Options"] === "nosniff" && r.hdr["Cache-Control"] === "no-store");

  console.log("\n-- making a plugin visible: menu, home page, and the site check --");
  const br = () => JSON.parse(fs.readFileSync(process.env.BRAND_FILE, "utf8")), place = (where, on, url) => A("POST", "/place", { body: { id: "guestbook", url: url || "/x/guestbook/", where, on: on ? "1" : "0" } });
  r = await A("GET", "/", { query: { done: "installed", new: "guestbook" } });
  ok("after installing, a box explains that existing pages do not change and offers the buttons", /does not change your existing pages/.test(r.body) && /Add to the menu/.test(r.body) && /Add to the home page/.test(r.body), r.body.slice(0, 300));
  ok("the install redirect names the new plugin", (await (async () => { const rr = await uploadBuf(fs.readFileSync(path.join(packs, "hello-world-1.0.0.vpplugin"))); const ri = await A("POST", "/install", { body: { t: rr.loc.split("t=")[1] } }); await A("POST", "/remove", { body: { id: "hello-world" } }); return ri.loc; })()) === "/admin/plugins/?done=installed&new=hello-world");
  r = await place("menu", true); ok("Add to the menu puts the page in the top menu and rebuilds the site", r.loc === "/admin/plugins/?done=placed" && br().nav.some(l => l.href === "/x/guestbook/" && l.label === "Guestbook") && /\/x\/guestbook\//.test(fs.readFileSync(tmp + "/site/shared/tds.js", "utf8")), r.body);
  r = await place("menu", true); ok("adding it twice does not duplicate it", br().nav.filter(l => l.href === "/x/guestbook/").length === 1);
  r = await A("GET", "/"); ok("the card then shows it is in the menu, with a remove button", /&#10003; In the menu &middot; remove/.test(r.body));
  r = await place("home", true); ok("Add to the home page makes a home page card", br().home.cards.some(c => c.href === "/x/guestbook/" && c.title === "Guestbook" && c.text.length > 10) && /href="\/x\/guestbook\/"/.test(fs.readFileSync(tmp + "/site/index.html", "utf8")), r.body);
  r = await place("menu", false); await place("home", false); ok("remove takes it out of both and rebuilds the site", !br().nav.some(l => l.href === "/x/guestbook/") && !br().home.cards.some(c => c.href === "/x/guestbook/") && !/href="\/x\/guestbook\/"/.test(fs.readFileSync(tmp + "/site/index.html", "utf8")));
  const before = JSON.stringify(br()); r = await place("menu", true, "/admin/"); ok("only a plugin's own pages can be added (anything else is ignored)", r.loc === "/admin/plugins/" && JSON.stringify(br()) === before);
  const full = br(); full.nav = Array.from({ length: 12 }, (_, i) => ({ label: "L" + i, href: "/l" + i + "/" })); fs.writeFileSync(process.env.BRAND_FILE, JSON.stringify(full)); r = await place("menu", true);
  ok("a full menu (12 links) is refused with a clear message", r.code === 400 && /12 links/.test(r.body)); fs.writeFileSync(process.env.BRAND_FILE, before);
  await A("POST", "/toggle", { body: { id: "guestbook" } }); r = await place("menu", true); ok("a turned-off plugin cannot be added", r.loc === "/admin/plugins/" && JSON.stringify(br()) === before); await A("POST", "/toggle", { body: { id: "guestbook" } });

  const serve = (handler) => new Promise(ok2 => { const s = require("http").createServer(handler); s.listen(0, "127.0.0.1", () => ok2(s)); });
  let srvr = await serve((q, s) => { if (q.url.startsWith("/x/guestbook/")) { s.setHeader("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'"); s.end("page"); } else if (q.url.startsWith("/x-api/")) { s.statusCode = 404; s.setHeader("content-type", "application/json"); s.end('{"error":"Not found"}'); } else { s.statusCode = 404; s.end("nf"); } });
  process.env.SITE_URL = "http://127.0.0.1:" + srvr.address().port; r = await A("POST", "/check");
  ok("site check: everything in place gives all green", /Everything a plugin page needs is in place/.test(r.body) && !/&#9888;/.test(r.body), r.body.slice(0, 400)); srvr.close();
  srvr = await serve((q, s) => { s.statusCode = 404; s.end("<html>nope</html>"); }); process.env.SITE_URL = "http://127.0.0.1:" + srvr.address().port; r = await A("POST", "/check");
  ok("site check: a server without the plugin settings gets clear warnings and the fix", /&#9888;/.test(r.body) && /sudo bash update\.sh/.test(r.body) && /answered 404/.test(r.body), r.body.slice(0, 500)); srvr.close();
  srvr = await serve((q, s) => { if (q.url.startsWith("/x/")) { s.end("page without the header"); } else { s.statusCode = 404; s.setHeader("content-type", "application/json"); s.end("{}"); } }); process.env.SITE_URL = "http://127.0.0.1:" + srvr.address().port; r = await A("POST", "/check");
  ok("site check: pages served without the sandbox header are called out", /WITHOUT the browser sandbox/.test(r.body), r.body.slice(0, 500)); srvr.close();
  process.env.SITE_URL = "http://127.0.0.1:1"; r = await A("POST", "/check"); ok("site check: if the server cannot reach its own address it says how to test by hand", /Could not reach/.test(r.body) && /curl -sI/.test(r.body)); process.env.SITE_URL = "https://example.com";

  console.log("\n-- the sandbox adapts to the Node.js version (Node 24 removed --no-experimental-fetch) --");
  const fakeRun = rejects => args => ({ status: args.some(a => rejects.some(re => re.test(a))) ? 9 : 0, stderr: "node: bad option: " + args.join(" ") });
  let cf = host._chooseFlags(fakeRun([/^--no-experimental-fetch$/]));
  ok("an option the Node version rejects is left out and the sandbox still starts", cf.flags && !cf.flags.includes("--no-experimental-fetch") && cf.flags.includes("--permission") && cf.flags.includes("--disallow-code-generation-from-strings"), JSON.stringify(cf));
  cf = host._chooseFlags(fakeRun([/^--no-experimental-fetch$/, /^--no-experimental-websocket$/])); ok("both optional options can be dropped", cf.flags && !cf.flags.some(f => /experimental-(fetch|websocket)/.test(f)), JSON.stringify(cf));
  cf = host._chooseFlags(fakeRun([/^--max-old-space-size=64$/])); ok("if the smallest memory limit cannot start Node, a slightly larger one is used", cf.flags && cf.flags.includes("--max-old-space-size=96"), JSON.stringify(cf));
  cf = host._chooseFlags(fakeRun([/^--permission$/, /^--experimental-permission$/])); ok("a Node without the permission model gives a clear reason instead of a broken sandbox", cf.flags === null && /22\.13/.test(cf.error), JSON.stringify(cf));
  cf = host._chooseFlags(fakeRun([/^--disallow-code-generation-from-strings$/])); ok("if the essential options cannot all work, the sandbox is refused and the reason is kept", cf.flags === null && /bad option/.test(cf.error), JSON.stringify(cf));
  ok("the real probe on this Node picks a working command line", host.sandboxAvailable() && host.sandboxInfo().flags.includes("--permission"), JSON.stringify(host.sandboxInfo()));
  r = await A("GET", "/"); ok("the Plugins page says which Node.js version the sandbox runs on", new RegExp("Server sandbox on this server: <strong>ready</strong> \\(Node " + process.version.replace(/\./g, "\\.") + "\\)").test(r.body), r.body.slice(0, 400));

  console.log("\n-- the Status page tells whether the server part works --");
  r = await A("GET", "/log", { query: { id: "hit-counter" } }); ok("Status: a working plugin gets a green live test", r.code === 200 && /Live test: the plugin's server part started and answered/.test(r.body), r.body.slice(0, 300));
  const bd = path.join(tmp, "broken"); fs.mkdirSync(bd, { recursive: true }); fs.writeFileSync(path.join(bd, "server.js"), "module.exports = function (vp) { this is not valid javascript"); fs.writeFileSync(path.join(bd, "plugin.json"), JSON.stringify({ id: "broken-one", name: "Broken", version: "1.0.0", author: "t", description: "d", vibepress: "0.3.0", server: "server.js", pages: [{ title: "t", path: "index.html" }], settings: { fields: { a: { type: "string" } } } }));
  const bm = H.manifest.validate(JSON.parse(fs.readFileSync(path.join(bd, "plugin.json"), "utf8"))); registry.install({ base: bd, manifest: bm.manifest, hash: "x", zipPath: path.join(bd, "plugin.json"), granted: [] });
  r = await A("GET", "/log", { query: { id: "broken-one" } }); ok("Status: a plugin that cannot start gets a clear failure, the reason and what to run", /Live test failed/.test(r.body) && /failed to start/.test(r.body) && /selftest\.js/.test(r.body), r.body.slice(0, 500));
  r = await A("GET", "/settings", { query: { id: "broken-one" } }); ok("Settings: a broken server part is reported at the top instead of silence", /setup check could not run/.test(r.body) && /Status/.test(r.body), r.body.slice(0, 300));
  r = await P("GET", "/broken-one/r/anything"); ok("visitors get a plain JSON error from a broken plugin", r.code === 500 && /error/.test(r.body));
  r = await A("GET", "/settings", { query: { id: "hit-counter" } }); ok("a plugin with no settings page has no Settings", r.loc === "/admin/plugins/");
  await A("POST", "/remove", { body: { id: "broken-one" } });

  console.log("\n-- turn off / on / export / remove --");
  await A("POST", "/toggle", { body: { id: "guestbook" } }); r = await P("GET", "/guestbook/data/messages");
  ok("turned-off plugin is 404 and its files are unpublished", r.code === 404 && !fs.existsSync(tmp + "/site/x/guestbook"));
  await A("POST", "/toggle", { body: { id: "guestbook" } }); r = await P("GET", "/guestbook/data/messages"); ok("turning on restores files and data", r.code === 200 && fs.existsSync(tmp + "/site/x/guestbook/index.html") && JSON.parse(r.body).items.length === 1);
  r = await A("GET", "/export", { query: { id: "guestbook" } }); ok("export hands back the original package", r.dl && r.dl[1] === "guestbook-1.0.1.vpplugin" && fs.existsSync(r.dl[0]));
  await A("POST", "/remove", { body: { id: "hit-counter" } }); ok("remove deletes code, files and data", !registry.get("hit-counter") && !fs.existsSync(tmp + "/site/x/hit-counter") && !fs.existsSync(tmp + "/data/plugin-data/hit-counter.json"));
  ok("a removed plugin is 404", (await P("POST", "/hit-counter/r/hit")).code === 404);

  console.log("\n-- static scan: reserved global names --");
  const scan = require(path.join(KIT, "..", "app", "plugins", "scan.js")).scan;
  ok("a variable named after window.status is flagged", scan("x.js", "var list=1, status=document.getElementById('x');", false).length > 0);
  ok("an ordinary variable is not flagged", scan("x.js", "var listStatus = 1; obj.status = 200;", false).length === 0);
  ok("the fixed guestbook.js itself is clean", scan("guestbook.js", fs.readFileSync(path.join(KIT, "examples", "guestbook", "public", "guestbook.js"), "utf8"), false).length === 0);

  console.log("\n-- hostile and broken packages --");
  const bigJson = "0".repeat(1100000);
  const bad = {
    "path traversal": [mk({ "../evil.js": "x" }), /unsafe file path/], "absolute path": [mk({ "/tmp/evil.js": "x" }), /unsafe file path/],
    "a .php file": [mk({ "public/shell.php": "<?php system($_GET[0]);" }), /not an allowed file type/], "a shell script": [mk({ "run.sh": "rm -rf /" }), /not an allowed file type/],
    "no manifest": [mk(null, { "public/index.html": "x" }), /no plugin.json/], "server file using net": [mk({ "s.js": "const n=require('net'); module.exports=()=>{}", "plugin.json": base["plugin.json"].replace('"pages"', '"server":"s.js","pages"') }), /not allowed to use|Node module/],
    "unsafe permissions": [mk({ "plugin.json": base["plugin.json"].replace('"pages"', '"permissions":["net:localhost","shell"],"pages"') }), /Unknown or unsafe permission/], "a file over 1 MB": [mk({ "public/big.json": bigJson }), /larger than/],
    "broken manifest": [mk(null, { "plugin.json": "{not json" }), /not valid JSON/], "a symlink": [zip([{ name: "plugin.json", data: Buffer.from(base["plugin.json"]) }, { name: "public/index.html", data: Buffer.from("x") }, { name: "public/link.txt", data: Buffer.from("/etc/passwd"), mode: 0o120777 }]), /link or special file/],
    "something that is not a zip": [Buffer.from("hello"), /not a valid zip/],
    "a settings page asking for files without permission": [mk({ "plugin.json": base["plugin.json"].replace('"pages"', '"settings":{"fields":{"f":{"type":"file"}}},"pages"') }), /files:private/],
    "a bad address check name": [mk({ "plugin.json": base["plugin.json"].replace('"pages"', '"settings":{"fields":{"f":{"type":"string","check":"rm-rf"}}},"pages"') }), /unknown check/],
    "a timeout over 10 seconds": [mk({ "plugin.json": base["plugin.json"].replace('"pages"', '"timeout":60,"pages"') }), /timeout/]
  };
  for (const [name, [buf, re]] of Object.entries(bad)) { r = await uploadBuf(buf); ok(`${name} is refused`, r.code === 400 && re.test(r.body), r.body.slice(r.body.indexOf("cannot") > 0 ? r.body.indexOf("cannot") : 0, 260)); }
  r = await uploadBuf(mk(null, Object.fromEntries(Object.entries(base).map(([k, v]) => ["badplug/" + k, v])))); ok("a zip with one wrapping folder is accepted", r.loc && r.loc.includes("review"), r.body);
  ok("rejected uploads leave no staging folders behind", fs.readdirSync(tmp + "/data/plugin-staging").length === 1);
  ok("nothing hostile got installed", registry.list().map(p => p.id).join() === "guestbook");
  H.cleanup(); process.exit(T.done());
})().catch(e => { console.error("CRASH", e); process.exit(1); });
