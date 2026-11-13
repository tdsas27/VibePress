// Unit tests for Admin > Maintenance: closed-site message, generated Nginx include, Node guard, preview cookie, auto-reopen,
// the live check, and the installer/updater steps (run for real in bash with stand-in nginx/systemctl commands).
//   node plugin-kit/tests/maintenance.unit.js
const fs = require("fs"), path = require("path"), http = require("http"), { spawnSync } = require("child_process");
const { load, makeCounter } = require("./harness");
const ROOT = path.join(__dirname, "..", "..");
const T = makeCounter(), ok = T.ok;
const H = load();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
fs.mkdirSync(process.env.SITE_DIR, { recursive: true }); fs.mkdirSync(process.env.VP_DATA_DIR, { recursive: true });
process.env.MAINT_NGINX_FILE = H.tmp + "/nginx-maintenance.conf"; process.env.NGINX_VHOST = H.tmp + "/vhost.conf";
const A = "/admin-abc123.x";
const M = require(path.join(ROOT, "app", "maintenance.js"))({ page: (t, b) => b, h1: t => `<h1>${t}</h1>`, esc, hidden: () => "", verifyCsrf: (q, s, n) => n(), A });
const call = (m, p, o) => H.call(M.admin, m, p, o || {});
const conf = () => fs.readFileSync(process.env.MAINT_NGINX_FILE, "utf8"), pageFile = () => fs.readFileSync(process.env.SITE_DIR + "/maintenance.html", "utf8");
const runGuard = (p, cookie) => { const res = { code: 0, hdr: {}, body: "", status(c) { this.code = c; return this; }, set(h) { Object.assign(this.hdr, h); return this; }, type() { return this; }, send(b) { this.body = b; return this; } };
  let passed = false; M.guard({ path: p, headers: cookie ? { cookie } : {} }, res, () => { passed = true; }); return { passed, res }; };
const form = o => Object.assign({ headline: "Back soon", message: "We are tuning things up.", back: "", contact: "", emoji: "🛠️", logo: "1", auto: "0" }, o || {});

(async () => {
  M.start();
  ok("start writes the page and an 'off' include so Nginx always has a file to read", /off/.test(conf()) && /vibepress-maintenance/.test(pageFile()) && !/return 503/.test(conf()), conf());
  ok("while the site is open the guard lets every request through", runGuard("/").passed && runGuard("/blog/x").passed);

  let r = await call("GET", "/");
  ok("the admin page opens and says the site is open", r.code === 200 && /The site is open/.test(r.body) && /name="headline"/.test(r.body) && /name="message"/.test(r.body), r.body.slice(0, 200));
  ok("...with fields for expected-back, contact, emoji, logo and auto-reopen", /name="back"/.test(r.body) && /name="contact"/.test(r.body) && /name="emoji"/.test(r.body) && /name="logo"/.test(r.body) && /name="auto"/.test(r.body));
  r = await call("POST", "/save", { body: form({ headline: "  " }) });
  ok("an empty headline is refused with a message", r.code === 400 && /enter a headline/.test(r.body));
  r = await call("POST", "/save", { body: form({ message: "" }) });
  ok("an empty message is refused with a message", r.code === 400 && /short message/.test(r.body));
  ok("...and nothing was switched on by a refused save", !M.isOn() && !/return 503/.test(conf()));

  r = await call("POST", "/save", { body: form({ headline: "Upgrading {name}", message: "Line one\nstill one\n\nSee https://status.example.com/now. Not javascript:alert(1)\n\n<script>alert(1)</script>", back: "Friday <b>6pm</b>", contact: "help@example.com" }) });
  ok("saving a message redirects back to the page", r.loc === "/admin/maintenance/?done=saved", r.loc);
  let pg = pageFile();
  ok("the visitor page has the headline, with {name} replaced by the site name", /<h1>Upgrading VibePress<\/h1>/.test(pg) && /<title>Upgrading VibePress \| VibePress<\/title>/.test(pg), pg.slice(0, 600));
  ok("paragraphs and line breaks come through", /<p class="vpm-msg">Line one<br>still one<\/p>/.test(pg));
  ok("an https:// address becomes a link and a trailing full stop is left out of it", /<a href="https:\/\/status\.example\.com\/now" rel="noopener">https:\/\/status\.example\.com\/now<\/a>\./.test(pg), pg);
  ok("javascript: text is never turned into a link", !/href="javascript/i.test(pg));
  ok("HTML typed into the message or the expected-back text is escaped, not run", !/<script>alert/.test(pg) && /&lt;script&gt;/.test(pg) && !/<b>6pm/.test(pg));
  ok("an email contact becomes a mailto link", /Questions\? <a href="mailto:help@example\.com">help@example\.com<\/a>/.test(pg));
  ok("the page asks search engines not to list it, loads only the site's own stylesheet and has no scripts", /name="robots" content="noindex,nofollow"/.test(pg) && /href="\/shared\/tds\.css"/.test(pg) && !/<script/i.test(pg.replace(/&lt;script&gt;/g, "")));
  ok("saving alone does not close the site", !M.isOn() && runGuard("/").passed && !/return 503/.test(conf()));
  ok("the live preview page shows the saved message", /Upgrading VibePress/.test((await call("GET", "/view")).body));

  r = await call("POST", "/on", { body: form({ headline: "Back soon", message: "Tuning.", auto: "2", contact: "https://example.com/help" }) });
  ok("'Save and close' closes the site and redirects", r.loc === "/admin/maintenance/?done=on" && M.isOn(), r.loc);
  const st = M.status();
  ok("a fresh secret preview token (32 hex) and an end time about 2 hours away were recorded", /^[0-9a-f]{32}$/.test(st.token) && Math.abs(st.until - (Date.now() + 7200e3)) < 5000, JSON.stringify(st));
  const c = conf();
  ok("the Nginx include answers everything with 503", /set \$vp_closed 1;/.test(c) && /if \(\$vp_closed\) \{ return 503; \}/.test(c) && /error_page 503 @vp_maintenance;/.test(c), c);
  ok("...serves site/maintenance.html with Retry-After, no-store and noindex", /rewrite \^ \/maintenance\.html break;/.test(c) && /Retry-After "3600" always/.test(c) && /Cache-Control "no-store" always/.test(c) && /X-Robots-Tag "noindex" always/.test(c));
  ok("...keeps the admin address open, with the dot escaped", c.includes('if ($uri ~ "^/admin-abc123\\.x/") { set $vp_closed 0; }'), c);
  ok("...keeps /shared/ (style files) open", c.includes('if ($uri ~ "^/shared/") { set $vp_closed 0; }'));
  ok("...and lets the preview cookie through", c.includes(`if ($cookie_vp_preview = "${st.token}") { set $vp_closed 0; }`));
  ok("the include has balanced braces and only plain directives", (c.match(/\{/g) || []).length === (c.match(/\}/g) || []).length && c.split("\n").every(l => !l.trim() || /^(#|set |if \(|error_page |location |rewrite |add_header |\}$)/.test(l.trim())), c);
  ok("the generated page file is the closed-site page with the new text", /Tuning\./.test(pageFile()) && /href="https:\/\/example\.com\/help"/.test(pageFile()));

  for (const p of ["/", "/blog/hello", "/x-api/guestbook/entries", "/get/app", "/feedback/", "/some/unknown/page"]) {
    const g = runGuard(p);
    ok(`the app's own guard closes ${p} with a 503 and the message`, !g.passed && g.res.code === 503 && /vibepress-maintenance/.test(g.res.body) && g.res.hdr["Retry-After"] === "3600" && g.res.hdr["Cache-Control"] === "no-store" && g.res.hdr["X-Robots-Tag"] === "noindex", JSON.stringify(g.res.hdr));
  }
  ok("the admin stays open (login page and deep pages)", runGuard(A + "/login").passed && runGuard(A + "/maintenance/").passed && runGuard(A).passed);
  ok("a look-alike address does not count as the admin", !runGuard(A + "-evil/x").passed && !runGuard("/admin/login").passed);
  ok("/shared/ stays open so the message is styled", runGuard("/shared/tds.css").passed);
  ok("the right preview cookie lets a browser through", runGuard("/", "a=1; vp_preview=" + st.token).passed);
  ok("a wrong, empty or old-looking preview cookie does not", !runGuard("/", "vp_preview=" + "0".repeat(32)).passed && !runGuard("/", "vp_preview=").passed && !runGuard("/", "xvp_preview=" + st.token).passed);

  r = await call("GET", "/");
  ok("the admin page now says maintenance mode is ON, with the end time and the real-site button", /Maintenance mode is ON/.test(r.body) && /reopens by itself/.test(r.body) && /Show me the real site/.test(r.body) && /Reopen the site now/.test(r.body));
  ok("...and no longer offers 'Save and close'", !/Save and close the site/.test(r.body));
  r = await call("POST", "/preview");
  ok("'Show me the real site' sets an HttpOnly, 12-hour cookie holding the token", r.cookies && r.cookies.vp_preview && r.cookies.vp_preview.value === st.token && r.cookies.vp_preview.opts.httpOnly === true && r.cookies.vp_preview.opts.path === "/" && r.cookies.vp_preview.opts.maxAge === 12 * 3600e3, JSON.stringify(r.cookies));
  r = await call("GET", "/", { headers: { cookie: "vp_preview=" + st.token } });
  ok("...and the page then says this browser sees the real site", /This browser can see the real site/.test(r.body) && /Stop previewing/.test(r.body));
  r = await call("POST", "/unpreview");
  ok("'Stop previewing' clears the cookie", r.cookies && r.cookies.vp_preview === null);
  const oldToken = st.token;
  r = await call("POST", "/off");
  ok("reopening switches the site off and goes back", r.loc === "/admin/maintenance/?done=off" && !M.isOn());
  ok("...the include is 'off' again and the token is gone", !/return 503/.test(conf()) && M.status().token === "" && M.status().until === 0);
  ok("...the guard lets everything through, and old preview cookies mean nothing", runGuard("/").passed && runGuard("/blog/").passed);
  await call("POST", "/on", { body: form({ auto: "0" }) });
  ok("closing again makes a different token, so a stale cookie stays out", M.status().token !== oldToken && !runGuard("/", "vp_preview=" + oldToken).passed);
  ok("'Never' auto-reopen leaves no end time", M.status().until === 0);
  await call("POST", "/off");

  // automatic reopening
  await call("POST", "/on", { body: form({ auto: "1" }) });
  const realNow = Date.now; Date.now = () => realNow() + 61 * 60e3;
  const g = runGuard("/");
  ok("after the chosen hours the guard reopens the site by itself", g.passed && !M.isOn() && !/return 503/.test(conf()), conf());
  Date.now = realNow;
  r = await call("POST", "/save", { body: form({ auto: "7" }) });
  await call("POST", "/on", { body: form({ auto: "7" }) });
  ok("an invalid auto-reopen choice means 'never'", M.status().until === 0); await call("POST", "/off");

  // live check against stand-in web servers
  const serve = body => new Promise(res => { const s = http.createServer((q, p) => { p.statusCode = body.code; p.end(body.text); }).listen(0, "127.0.0.1", () => res(s)); });
  await call("POST", "/on", { body: form() });
  let s = await serve({ code: 503, text: "<html>" + "<!-- vibepress-maintenance -->" + "</html>" }), url = "http://127.0.0.1:" + s.address().port;
  let v = M.verdict(await M.probe(url, "example.com"));
  ok("check: closed + a 503 showing our page = confirmed", v.ok === true && /Confirmed/.test(v.text), JSON.stringify(v)); s.close();
  s = await serve({ code: 200, text: "real site" }); url = "http://127.0.0.1:" + s.address().port;
  v = M.verdict(await M.probe(url, "example.com"));
  ok("check: closed but the web server still answers 200 = honest warning pointing at the setup note", v.ok === false && /still see the real site/.test(v.text) && /200/.test(v.text), JSON.stringify(v));
  s.close();
  s = await serve({ code: 503, text: "some other 503" }); url = "http://127.0.0.1:" + s.address().port;
  v = M.verdict(await M.probe(url, "example.com"));
  ok("check: a 503 that is not our page does not count as confirmed", v.ok === false, JSON.stringify(v)); s.close();
  const dead = await M.probe("http://127.0.0.1:1", "example.com");
  v = M.verdict(dead);
  ok("check: a server that cannot be reached gives a neutral message, not a claim either way", dead.error && v.ok === null && /private browser window/.test(v.text), JSON.stringify(v));
  await call("POST", "/off");
  s = await serve({ code: 200, text: "real site" }); url = "http://127.0.0.1:" + s.address().port;
  ok("check: open + 200 = confirmed open", M.verdict(await M.probe(url, "example.com")).ok === true); s.close();
  s = await serve({ code: 503, text: "<!-- vibepress-maintenance -->" }); url = "http://127.0.0.1:" + s.address().port;
  ok("check: open but still showing the closed page = tells you to wait", M.verdict(await M.probe(url, "example.com")).ok === false, ""); s.close();
  s = await serve({ code: 503, text: "<!-- vibepress-maintenance -->" }); process.env.VP_MAINT_PROBE = "http://127.0.0.1:" + s.address().port;
  await call("POST", "/on", { body: form() });
  r = await call("POST", "/check");
  ok("the 'Check what visitors get' button shows the result on the page", r.code === 200 && /Confirmed: the web server is showing the maintenance page/.test(r.body), r.body.slice(-600)); s.close(); delete process.env.VP_MAINT_PROBE;
  await call("POST", "/off");

  // one-time setup note
  fs.writeFileSync(process.env.NGINX_VHOST, "server { include /x/nginx-firewall.conf; }");
  ok("an Nginx site file without the include is detected, and the page explains the one-time update", M.setupState() === "missing" && /One-time setup needed/.test((await call("GET", "/")).body));
  fs.writeFileSync(process.env.NGINX_VHOST, "server { include /x/nginx-maintenance.conf; }");
  ok("with the include present there is no setup note", M.setupState() === "ok" && !/One-time setup needed/.test((await call("GET", "/")).body));
  fs.unlinkSync(process.env.NGINX_VHOST);
  ok("an unreadable Nginx site file is 'unknown', with no false alarm", M.setupState() === "unknown" && !/One-time setup needed/.test((await call("GET", "/")).body));

  // an unwritable include is reported, not hidden
  const savedF = process.env.MAINT_NGINX_FILE; process.env.MAINT_NGINX_FILE = H.tmp + "/no-such-dir/x.conf";
  await call("POST", "/on", { body: form() });
  ok("if the include cannot be written the admin page says so", /cannot write/.test((await call("GET", "/")).body)); process.env.MAINT_NGINX_FILE = savedF; await call("POST", "/off");

  // wiring + installer/updater
  const srv = fs.readFileSync(path.join(ROOT, "app", "server.js"), "utf8"), tpl = fs.readFileSync(path.join(ROOT, "nginx", "vibepress.conf.template"), "utf8"), inst = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
  ok("server.js mounts the guard before the public routes and the admin page behind sign-in", srv.indexOf("app.use(maint.guard)") > 0 && srv.indexOf("app.use(maint.guard)") < srv.indexOf('app.use("/blog"') && /r\.use\("\/maintenance", requireAuth, maint\.admin\)/.test(srv) && /maint\.start\(\)/.test(srv));
  ok("the dashboard has a Maintenance tile and an ON banner", /"Maintenance", "var\(--red\)", "\/admin\/maintenance\/"/.test(srv) && /Maintenance mode is ON/.test(srv));
  ok("the Nginx site template includes the maintenance file right after the firewall one", /nginx-firewall\.conf;[^\n]*\n\s*include __APP_DIR__\/data\/nginx-maintenance\.conf;/.test(tpl));
  ok("a fresh install creates the include file and watches it for changes", /echo "# Maintenance mode is off\." > "\$DIR\/app\/data\/nginx-maintenance\.conf"/.test(inst) && /PathChanged=\$DIR\/app\/data\/nginx-firewall\.conf\nPathChanged=\$DIR\/app\/data\/nginx-maintenance\.conf/.test(inst));

  const upd = fs.readFileSync(path.join(ROOT, "update.sh"), "utf8");
  const snip = upd.slice(upd.indexOf('say "Setting up maintenance mode"'), upd.indexOf('\nsay "Restarting"'));
  const runUpdater = (nginxOk, vhost) => {
    const d = fs.mkdtempSync(H.tmp + "/upd-"); fs.mkdirSync(d + "/bin"); fs.mkdirSync(d + "/dir/app/data", { recursive: true });
    fs.writeFileSync(d + "/vhost", vhost); fs.writeFileSync(d + "/watch.path", "[Path]\nPathChanged=" + d + "/dir/app/data/nginx-firewall.conf\n");
    fs.writeFileSync(d + "/bin/nginx", `#!/bin/sh\n[ "${nginxOk}" = 1 ]\n`, { mode: 0o755 });
    fs.writeFileSync(d + "/bin/systemctl", `#!/bin/sh\necho "$@" >> ${d}/sysctl.log\n`, { mode: 0o755 });
    const script = `set -euo pipefail\nsay(){ :; }\nDIR=${d}/dir; NGX=${d}/vhost; RUN_USER=$(id -un)\n` + snip.replace(/\/etc\/systemd\/system\/vibepress-firewall\.path/, d + "/watch.path");
    const out = spawnSync("bash", ["-c", script], { encoding: "utf8", env: Object.assign({}, process.env, { PATH: d + "/bin:" + process.env.PATH }) });
    return { d, out, vhost: fs.readFileSync(d + "/vhost", "utf8"), watch: fs.readFileSync(d + "/watch.path", "utf8"), log: fs.existsSync(d + "/sysctl.log") ? fs.readFileSync(d + "/sysctl.log", "utf8") : "", file: fs.existsSync(d + "/dir/app/data/nginx-maintenance.conf") ? fs.readFileSync(d + "/dir/app/data/nginx-maintenance.conf", "utf8") : null };
  };
  const old = "server {\n    listen 443 ssl;\n    include /var/www/vibepress/app/data/nginx-firewall.conf;     # block rules\n    location / { try_files $uri =404; }\n}\n";
  let u = runUpdater(1, old);
  ok("updater: an existing install gets the include line added once, right after the firewall one", u.out.status === 0 && (u.vhost.match(/nginx-maintenance\.conf/g) || []).length === 1 && /nginx-firewall\.conf;[^\n]*\n\s+include [^\n]*nginx-maintenance\.conf;\n/.test(u.vhost), u.out.stderr + u.vhost);
  ok("updater: creates the 'off' include file before Nginx is asked to read it", u.file && /off/.test(u.file));
  ok("updater: Nginx is reloaded and the file watcher also watches the new file", /reload nginx/.test(u.log) && /nginx-maintenance\.conf/.test(u.watch) && /daemon-reload/.test(u.log) && /restart vibepress-firewall\.path/.test(u.log), u.log + u.watch);
  const u2 = runUpdater(1, u.vhost);
  ok("updater: running it again changes nothing (no second include)", u2.out.status === 0 && (u2.vhost.match(/nginx-maintenance\.conf/g) || []).length === 1);
  const u3 = runUpdater(0, old);
  ok("updater: if Nginx refuses the new settings the old site file is put back and a clear warning is printed", u3.out.status === 0 && u3.vhost === old && /did not accept the maintenance-mode settings/.test(u3.out.stdout), u3.out.stdout + u3.vhost);
  const u4 = runUpdater(1, "server {\n    location / { try_files $uri =404; }\n}\n");
  ok("updater: a site file with no firewall include is left alone with the warning (never half-edited)", u4.vhost === "server {\n    location / { try_files $uri =404; }\n}\n" && /did not accept/.test(u4.out.stdout), u4.out.stdout);

  // docs and versions
  ok("docs mention maintenance mode", /Maintenance/.test(fs.readFileSync(path.join(ROOT, "docs", "FEATURES.md"), "utf8")) && /Maintenance/.test(fs.readFileSync(path.join(ROOT, "docs", "CHEATSHEET.md"), "utf8")) && /0\.5\.0/.test(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8")));
  const v0 = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  ok("the four version places agree", v0 === JSON.parse(fs.readFileSync(path.join(ROOT, "app", "package.json"), "utf8")).version && new RegExp(`PLATFORM = "${v0}"`).test(fs.readFileSync(path.join(ROOT, "app", "plugins", "manifest.js"), "utf8")) && fs.readFileSync(path.join(ROOT, "app", "plugins", "index.js"), "utf8").includes("vibepress-" + v0), v0);
  const code = T.done(); H.cleanup(); process.exit(code);
})().catch(e => { console.log("CRASH " + e.stack); process.exit(1); });
