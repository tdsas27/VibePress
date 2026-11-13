/* VibePress plugins: the public /x-api/ router (what plugin pages talk to) and Admin > Plugins (install, review, moderate). */
const express = require("express"), multer = require("multer"), fs = require("fs"), path = require("path"), crypto = require("crypto"), http = require("http"), https = require("https");
const UI = require("../ui"), registry = require("./registry"), host = require("./host"), pdata = require("./pdata"), pkg = require("./package"), P = require("./paths"), pfiles = require("./files"), brandfile = require("../brandfile");
const { describePerm, current } = require("./manifest");

module.exports = ({ page, h1, esc, hidden, verifyCsrf, listPages, siteInfo }) => {
  host.configure({ listPages: listPages || (() => []), siteInfo: siteInfo || (() => ({})) });
  const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");
  const MAXOUT = 262144, TOKEN = /^[a-f0-9]{16}$/, ID = /^[a-z][a-z0-9-]{2,29}$/;

  /* ------------------------------ public: /x-api/<id>/... ------------------------------ */
  const hits = new Map(), busy = new Map();
  const limited = (key, max, ms) => { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); if (a.length >= max) { hits.set(key, a); return true; } a.push(now); hits.set(key, a); return false; };
  setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 86400000)) hits.delete(k); }, 300000).unref();
  const who = (req, id) => crypto.createHmac("sha256", SECRET).update(id + "|" + (req.headers["x-real-ip"] || req.socket.remoteAddress || "")).digest("hex").slice(0, 16);   // anonymous code, never the address

  const pub = express.Router();
  pub.use((req, res, next) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" });
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  pub.use(express.json({ limit: "32kb" }));
  pub.use("/:id", async (req, res) => {
    const id = req.params.id, entry = ID.test(id) && registry.get(id);
    if (!entry || !entry.enabled) return res.status(404).json({ error: "Not found" });
    if (!/^(GET|POST)$/.test(req.method)) return res.status(405).json({ error: "Method not allowed" });
    const visitor = who(req, id), parts = req.path.split("/").filter(Boolean);
    if (limited("r:" + visitor, 120, 60000)) return res.status(429).json({ error: "Too many requests. Please slow down." });

    if (parts[0] === "dl" && parts.length === 2 && req.method === "GET") {         // a short-lived link handed out by the plugin (vp.files.grant)
      if (!entry.permissions.includes("files:private") || !/^[A-Za-z0-9_-]{20,64}$/.test(parts[1])) return res.status(404).json({ error: "Not found" });
      const fid = pdata.grants.use(id, parts[1]), rec = fid && pdata.files.get(id, fid), fp = rec && pfiles.pathOf(id, fid);
      if (!rec || !fp || !fs.existsSync(fp)) return res.status(410).json({ error: "This download link has expired. Go back and ask for a new one." });
      res.set({ "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream" });
      return res.download(fp, rec.name);
    }

    if (parts[0] === "data" && parts.length === 2) {                              // collections: handled here, no plugin code involved
      const spec = (entry.collections || {})[parts[1]];
      if (!spec) return res.status(404).json({ error: "Not found" });
      if (req.method === "GET") {
        if (!spec.publicRead) return res.status(403).json({ error: "Not public" });
        return res.json({ items: pdata.publicList(id, parts[1], parseInt(req.query.limit, 10) || 50) });
      }
      if (!spec.publicWrite) return res.status(403).json({ error: "Not open for new entries" });
      if (limited("w:" + visitor, 5, 60000) || limited("wd:" + visitor, 40, 86400000)) return res.status(429).json({ error: "Too many entries. Please try again later." });
      const c = pdata.check(spec, req.body);
      if (c.error) return res.status(400).json({ error: c.error });
      try { const approved = pdata.add(id, parts[1], spec, c.values); return res.json({ ok: true, pending: !approved }); }
      catch (e) { return res.status(507).json({ error: "This plugin's storage is full." }); }
    }

    if (parts[0] === "r" && entry.hasServer) {                                    // sandboxed plugin code
      if (/^__/.test(parts[1] || "")) return res.status(404).json({ error: "Not found" });   // routes starting with __ are for the admin screens only
      if ((busy.get(id) || 0) >= 6) return res.status(503).json({ error: "Busy. Try again in a moment." });
      busy.set(id, (busy.get(id) || 0) + 1);
      try {
        const query = {}; for (const [k, v] of Object.entries(req.query).slice(0, 20)) if (typeof v === "string") query[String(k).slice(0, 40)] = v.slice(0, 300);
        const out = (await host.call(id, { method: req.method, path: "/" + parts.slice(1).join("/"), query, body: req.method === "POST" && req.body && typeof req.body === "object" ? req.body : null, visitor })) || {};
        const status = Number.isInteger(out.status) && out.status >= 200 && out.status <= 599 ? out.status : 200;
        if (out.json !== undefined) { const s = JSON.stringify(out.json); if (s === undefined || s.length > MAXOUT) throw Object.assign(new Error("The plugin's answer was too large."), { status: 502 }); return res.status(status).type("application/json").send(s); }
        if (typeof out.text === "string") return res.status(status).type("text/plain").send(out.text.slice(0, MAXOUT));
        if (typeof out.html === "string") return res.status(status).set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:").type("text/html").send(out.html.slice(0, MAXOUT));
        return res.status(status).json({ ok: true });
      } catch (e) { return res.status(e.status || 500).json({ error: String(e.message || "The plugin could not answer.").slice(0, 200) }); }
      finally { busy.set(id, Math.max(0, (busy.get(id) || 1) - 1)); }
    }
    res.status(404).json({ error: "Not found" });
  });
  pub.use((err, req, res, next) => res.status(400).json({ error: "That request could not be read." }));

  /* ------------------------------ admin: /admin/plugins/ ------------------------------ */
  const admin = express.Router();
  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: pkg.LIMITS.zip, files: 1 } });
  const kb = n => n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB";
  const finding = f => `<li class="${f.level === "block" ? "err" : "meta"}">${f.level === "block" ? "Blocked" : "Warning"} &ndash; <code>${esc(f.file)}</code> ${esc(f.msg)}</li>`;
  const cleanStaging = () => { try { for (const d of fs.readdirSync(P.staging())) { const p = path.join(P.staging(), d); if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true }); } } catch {} };

  const list = (req, msg, ok, newId) => {
    cleanStaging();
    const items = registry.list(), sb = host.sandboxAvailable(), sbi = host.sandboxInfo();
    return page("Plugins", `${h1("Plugins")}<p><a href="/admin/">&larr; Dashboard</a></p>
${msg ? `<p class="err">${esc(msg)}</p>` : ""}${ok ? `<p class="note" style="margin-top:0">${esc(ok)}</p>` : ""}
<p class="meta">Plugins add pages and features to your site. Pages run in a locked browser sandbox. Anything that needs the server runs in a locked server sandbox. You see exactly what a plugin asks for before it is installed. Only install plugins from people you trust.</p>
<p class="meta">Server sandbox on this server: <strong>${sb ? "ready" : "not available"}</strong> (Node ${esc(sbi.node)})${sb ? "" : `: ${esc(sbi.error || "unknown reason")}. Plugins without server code still work`}. Run <code>node app/plugins/selftest.js</code> to test it.</p>
${nextSteps(req, newId)}
<h3 class="cat">Install a plugin</h3>
<form method="post" action="/admin/plugins/upload" enctype="multipart/form-data" class="wide">
<label>Plugin file (.vpplugin or .zip, up to 5 MB)<input type="file" name="file" accept=".vpplugin,.zip" required></label>${hidden(req)}
<button>Review plugin</button></form>
<h3 class="cat">Installed (${items.length})</h3>
<form class="inline" method="post" action="/admin/plugins/check">${hidden(req)}<button>Check that my website serves plugins</button></form>
${items.length ? items.map(p => card(req, p)).join("") : "<p class=\"meta\">Nothing installed yet. The <code>plugin-kit/examples</code> folder has three small ones to try.</p>"}`, { head: UI + CSS });
  };
  /* ---- the owner's "Setup check": the plugin may offer an admin-only route /__status that explains what is still missing ---- */
  const diagnose = async p => {
    if (!p.hasServer || !p.enabled) return { none: true };
    try {
      const out = await host.call(p.id, { method: "GET", path: "/__status", query: {}, body: null, visitor: "admin" });
      if (!out || out.status === 404) return { none: true, alive: true };
      const items = out.json && Array.isArray(out.json.items) ? out.json.items.slice(0, 40).map(i => ({ ok: !!(i && i.ok), text: String((i && i.text) || "").slice(0, 300), fix: String((i && i.fix) || "").slice(0, 300) })) : null;
      return items ? { items } : { none: true };
    } catch (e) { return { error: String(e.message).slice(0, 200), id: p.id }; }
  };
  const diagHtml = d => d.items ? d.items.map(x => `<div class="pl" style="border-color:var(--${x.ok ? "green" : "orange"});padding:.5rem 1rem;margin:.4rem 0"><strong>${x.ok ? "&#10003;" : "&#9888;"} ${esc(x.text)}</strong>${!x.ok && x.fix ? `<br><span class="meta">${esc(x.fix)}</span>` : ""}</div>`).join("") : d.error ? `<p class="err">The setup check could not run: ${esc(d.error)}. The plugin's server part is not working: open its <a href="/admin/plugins/log?id=${esc(d.id || "")}">Status</a> page for the reason.</p>` : `<p class="meta">This plugin has no setup check of its own${d.alive ? ", but its server part is running" : ""}.</p>`;
  /* ---- making a plugin's page visible: one click to put it in the top menu or on the home page ---- */
  const COLORS = ["red", "orange", "yellow", "green", "blue", "purple"], DEFAULT_NAV = [{ label: "Games", href: "/games/" }, { label: "Blog", href: "/blog/" }];
  const placed = url => { const b = brandfile.read(); return { menu: Array.isArray(b.nav) && b.nav.some(l => l && l.href === url), home: ((b.home || {}).cards || []).some(c => c && c.href === url) }; };
  const pageRow = (req, p, g) => {
    const at = placed(g.url), btn = (where, add, on) => `<form class="inline" method="post" action="/admin/plugins/place">${hidden(req)}<input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="url" value="${esc(g.url)}"><input type="hidden" name="where" value="${where}"><input type="hidden" name="on" value="${at[where] ? "0" : "1"}"><button>${at[where] ? "&#10003; " + on + " &middot; remove" : add}</button></form>`;
    return `<div style="margin:.5rem 0"><strong>${esc(g.title)}</strong> &middot; <a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.url)} &#8599;</a>${p.enabled ? `<div class="acts">${btn("menu", "Add to the menu", "In the menu")}${btn("home", "Add to the home page", "On the home page")}</div>` : ""}</div>`;
  };
  const nextSteps = (req, id) => {
    const p = ID.test(String(id || "")) && registry.get(id); if (!p) return "";
    return `<div class="pl" style="border-color:var(--green)"><h4>&#10003; ${esc(p.name)} is installed and turned on</h4>
<p style="margin:.3rem 0"><strong>It does not change your existing pages.</strong> ${p.pages.length ? "It adds its own page" + (p.pages.length > 1 ? "s" : "") + ", which visitors can only find if you link to " + (p.pages.length > 1 ? "them" : "it") + ". Add it to your menu or home page, or share its address:" : "It works behind the scenes; there is no page to link to."}</p>
${p.pages.map(g => pageRow(req, p, g)).join("")}
${p.settings ? `<p style="margin:.3rem 0"><strong>Next:</strong> <a href="/admin/plugins/settings?id=${esc(p.id)}">open its Settings</a> and fill them in.</p>` : ""}</div>`;
  };
  const CSS = `<style>.pl{border:2px solid var(--line);border-radius:1rem;padding:1rem 1.2rem;margin:.8rem 0;max-width:46rem}.pl h4{margin:0 0 .2rem}.pl .acts{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.7rem}.badge{display:inline-block;padding:.05rem .6rem;border-radius:2rem;font-size:.85rem;font-weight:700;background:var(--green);color:var(--onaccent)}.badge.off{background:var(--muted)}.tbl{border-collapse:collapse;width:100%}.tbl td,.tbl th{border-bottom:1px solid var(--line);padding:.4rem .5rem;text-align:left;vertical-align:top}</style>`;
  const card = (req, p) => {
    const st = p.hasServer ? host.status(p.id) : null;
    const cols = Object.keys(p.collections || {}).map(c => { const n = pdata.counts(p.id, c); return `<a href="/admin/plugins/entries?id=${esc(p.id)}&amp;c=${esc(c)}">${esc(c)}</a> (${n.total}${n.pending ? `, <strong>${n.pending} waiting</strong>` : ""})`; });
    return `<div class="pl"><h4>${esc(p.name)} <small class="meta">v${esc(p.version)} by ${esc(p.author)}</small> <span class="badge${p.enabled ? "" : " off"}">${p.enabled ? "On" : "Off"}</span></h4>
<p style="margin:.2rem 0">${esc(p.description)}</p>
${p.disabledReason ? `<p class="err" style="margin:.2rem 0">${esc(p.disabledReason)}</p>` : ""}
${p.pages.map(g => pageRow(req, p, g)).join("")}
${cols.length ? `<p class="meta" style="margin:.2rem 0">Collected: ${cols.join(", ")}</p>` : ""}
<p class="meta" style="margin:.2rem 0">${p.hasServer ? "Has sandboxed server code. " : "No server code. "}${p.permissions.length ? "Allowed to: " + esc(p.permissions.map(describePerm).join("; ")) + "." : "Asked for no extra permissions."}</p>
${p.settings && !Object.keys(pdata.settings.get(p.id).values).length && !Object.values(pdata.settings.get(p.id).lists).some(l => l.length) ? '<p class="err" style="margin:.2rem 0">Needs setup: open Settings before visitors use it.</p>' : ""}
<div class="acts"><form class="inline" method="post" action="/admin/plugins/toggle">${hidden(req)}<input type="hidden" name="id" value="${esc(p.id)}"><button>${p.enabled ? "Turn off" : "Turn on"}</button></form>
${p.settings ? `<a class="btn" href="/admin/plugins/settings?id=${esc(p.id)}" style="padding:.45rem .9rem">Settings</a>` : ""}${p.permissions.includes("files:private") ? `<a class="btn" href="/admin/plugins/files?id=${esc(p.id)}" style="padding:.45rem .9rem">Files (${pdata.files.list(p.id).length})</a>` : ""}
<a class="btn" href="/admin/plugins/export?id=${esc(p.id)}" style="padding:.45rem .9rem">Export to share</a>
${p.hasServer && p.settings ? `<a class="btn" href="/admin/plugins/diagnose?id=${esc(p.id)}" style="padding:.45rem .9rem">Setup check</a>` : ""}${p.hasServer ? `<a class="btn" href="/admin/plugins/log?id=${esc(p.id)}" style="padding:.45rem .9rem">Status${st && st.running ? " (running)" : ""}</a>` : ""}
<a class="btn" href="/admin/plugins/remove?id=${esc(p.id)}" style="padding:.45rem .9rem">Remove</a></div></div>`;
  };

  admin.get("/", (req, res) => res.send(list(req, "", req.query.done ? ({ installed: "Plugin installed and turned on.", removed: "Plugin removed.", changed: "Done.", placed: "Done. The site was rebuilt; hard-refresh your site to see it." }[req.query.done] || "") : "", req.query.new)));

  admin.post("/upload", (req, res, next) => up.single("file")(req, res, err => err ? res.status(400).send(list(req, "That file is too large (5 MB at most) or could not be uploaded.")) : next()), verifyCsrf, (req, res) => {
    if (!req.file) return res.status(400).send(list(req, "Choose a plugin file first."));
    const token = crypto.randomBytes(8).toString("hex"), dir = path.join(P.staging(), token);
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const zip = path.join(dir, "package.vpplugin"); fs.writeFileSync(zip, req.file.buffer, { mode: 0o600 });
      const r = pkg.inspect(zip, path.join(dir, "x"), current());
      const blocked = r.findings.filter(f => f.level === "block");
      if (!r.ok) { fs.rmSync(dir, { recursive: true, force: true }); return res.status(400).send(list(req, "This plugin cannot be installed: " + r.errors.concat(blocked.map(f => `${f.file} ${f.msg}`)).join(" ") )); }
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ manifest: r.manifest, hash: r.hash, findings: r.findings, files: r.files, base: path.relative(dir, r.base) }));
      res.redirect("/admin/plugins/review?t=" + token);
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); res.status(400).send(list(req, "That file could not be read as a plugin.")); }
  });

  const staged = t => { if (!TOKEN.test(String(t))) return null; try { const dir = path.join(P.staging(), t); return { dir, meta: JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) }; } catch { return null; } };
  admin.get("/review", (req, res) => {
    const s = staged(req.query.t); if (!s) return res.status(404).send(list(req, "That review has expired. Upload the plugin again."));
    const m = s.meta.manifest, old = registry.get(m.id);
    const perms = m.permissions.map((p, i) => `<label style="display:block;margin:.4rem 0"><input type="checkbox" name="p${i}" value="1" required style="width:auto"> ${esc(describePerm(p))}</label>`).join("");
    const cols = Object.entries(m.collections).map(([n, c]) => `<li><strong>${esc(n)}</strong>: visitors can add entries with ${Object.keys(c.fields).map(esc).join(", ")}${c.approval === "manual" ? "; <strong>you approve each one</strong> before it shows" : "; shown straight away"}</li>`).join("");
    res.send(page("Review plugin", `${h1("Review: " + esc(m.name))}<p><a href="/admin/plugins/">&larr; Cancel</a></p>
${old ? `<p class="note" style="margin-top:0">This replaces version ${esc(old.version)} that is installed now. The plugin's saved data is kept.</p>` : ""}
<div class="pl"><h4>${esc(m.name)} <small class="meta">v${esc(m.version)} by ${esc(m.author)}</small></h4><p>${esc(m.description)}</p>
<p class="meta" style="margin:.2rem 0">Fingerprint (SHA-256), compare with what the author published:<br><code style="word-break:break-all">${esc(s.meta.hash)}</code></p></div>
<h3 class="cat">What it adds</h3><ul>
${m.pages.map(p => `<li>A page: <strong>${esc(p.title)}</strong> at <code>/x/${esc(m.id)}/${p.path === "index.html" ? "" : esc(p.path)}</code> (runs in a locked browser sandbox)</li>`).join("")}${cols}
${m.settings ? `<li>A <strong>settings page</strong> in your admin (${[...Object.values(m.settings.fields).map(f => f.label), ...Object.values(m.settings.lists).map(l => l.label)].slice(0, 8).map(esc).join(", ")})</li>` : ""}
${m.timeout > 3 ? `<li>Its server code may take up to ${m.timeout} seconds per visitor request (it talks to other websites)</li>` : ""}
${m.server ? "<li><strong>Server code</strong> that runs in a locked server sandbox (no files, no internet except what is listed below, no other programs)</li>" : ""}</ul>
${s.meta.findings.length ? `<h3 class="cat">Things to look at</h3><ul>${s.meta.findings.map(finding).join("")}</ul>` : ""}
<details><summary>All ${s.meta.files.length} files</summary><table class="tbl">${s.meta.files.map(f => `<tr><td><code>${esc(f.rel)}</code></td><td>${kb(f.size)}</td></tr>`).join("")}</table></details>
<form method="post" action="/admin/plugins/install" class="wide">${hidden(req)}<input type="hidden" name="t" value="${esc(req.query.t)}">
<h3 class="cat">${m.permissions.length ? "It asks permission to" : "Permissions"}</h3>${perms || "<p>It asks for no extra permissions.</p>"}
${m.server ? `<label style="display:block;margin:.8rem 0"><input type="checkbox" name="trust" value="1" required style="width:auto"> I know this plugin's server code will run on my server, and I trust the person who wrote it.</label>` : ""}
<button>Install and turn on</button></form>`, { head: UI + CSS }));
  });

  admin.post("/install", verifyCsrf, (req, res) => {
    const s = staged(req.body.t); if (!s) return res.status(404).send(list(req, "That review has expired. Upload the plugin again."));
    const m = s.meta.manifest;
    if (m.permissions.some((p, i) => req.body["p" + i] !== "1") || (m.server && req.body.trust !== "1")) return res.status(400).send(list(req, "Tick every box to approve the plugin."));
    if (m.server && !host.sandboxAvailable()) return res.status(400).send(list(req, "This plugin has server code, and the server sandbox is not available here (Node 22.13 or newer is needed)."));
    try { host.stop(m.id); registry.install({ base: path.join(s.dir, s.meta.base), manifest: m, hash: s.meta.hash, zipPath: path.join(s.dir, "package.vpplugin"), granted: m.permissions }); }
    catch (e) { return res.status(500).send(list(req, "Install failed: " + String(e.message).slice(0, 150))); }
    fs.rmSync(s.dir, { recursive: true, force: true });
    res.redirect("/admin/plugins/?done=installed&new=" + m.id);
  });


  admin.post("/place", verifyCsrf, async (req, res) => {
    const p = ID.test(String(req.body.id)) && registry.get(req.body.id), g = p && p.enabled && p.pages.find(x => x.url === req.body.url);
    if (!g || !/^(menu|home)$/.test(String(req.body.where))) return res.redirect("/admin/plugins/");
    const on = req.body.on === "1", b = brandfile.read();
    if (req.body.where === "menu") {
      let nav = Array.isArray(b.nav) ? b.nav.slice() : DEFAULT_NAV.slice();
      if (on && !nav.some(l => l && l.href === g.url)) { if (nav.length >= 12) return res.status(400).send(list(req, "The menu already has 12 links. Remove one in Admin > Menu first.")); nav.push({ label: g.title.slice(0, 40), href: g.url }); }
      if (!on) nav = nav.filter(l => !(l && l.href === g.url));
      b.nav = nav;
    } else {
      b.home = b.home && typeof b.home === "object" ? b.home : {};
      let cards = Array.isArray(b.home.cards) ? b.home.cards.slice() : [];
      if (on && !cards.some(c => c && c.href === g.url)) { if (cards.length >= 12) return res.status(400).send(list(req, "The home page already has 12 cards. Remove one first.")); cards.push({ title: g.title.slice(0, 60), text: String(p.description || "").slice(0, 120), href: g.url, color: COLORS[cards.length % 6] }); }
      if (!on) cards = cards.filter(c => !(c && c.href === g.url));
      b.home.cards = cards;
    }
    brandfile.write(b);
    const r = await brandfile.render();
    if (!r.ok) { brandfile.undo(); return res.status(500).send(list(req, "The site could not be rebuilt, so nothing was changed. " + r.message)); }
    res.redirect("/admin/plugins/?done=placed");
  });

  /* ---- does the website itself serve plugins? (asks the site's own public address, the way a visitor would) ---- */
  const get = (url, ms) => new Promise(resolve => {
    let u; try { u = new URL(url); } catch { return resolve({ error: "the site address (SITE_URL) is not valid" }); }
    const rq = (u.protocol === "https:" ? https : http).get(u, { timeout: ms || 6000, headers: { "user-agent": "VibePress-selfcheck" } }, r => { r.resume(); resolve({ status: r.statusCode, headers: r.headers }); });
    rq.on("timeout", () => rq.destroy(new Error("timed out"))); rq.on("error", e => resolve({ error: e.message }));
  });
  const siteCheck = async () => {
    const base = String(process.env.SITE_URL || "").replace(/\/$/, ""), out = [], line = (ok, what, fix) => out.push({ ok, what, fix });
    const p = registry.list().find(x => x.enabled && x.pages.length);
    if (!base) { line(false, "The app does not know your site's address", "Set SITE_URL in /var/www/vibepress/app/.env and restart the service."); return out; }
    if (!p) { line(false, "There is no turned-on plugin with a page to test", "Install and turn on a plugin first."); return out; }
    const page_ = p.pages[0].url, onDisk = fs.existsSync(path.join(P.site(), "x", p.id));
    line(onDisk, onDisk ? `The files for ${p.name} are in the web folder` : `The files for ${p.name} are missing from the web folder`, "Turn the plugin off and on again, or reinstall it.");
    const a = await get(base + page_);
    if (a.error) { line(false, `Could not reach ${base}${page_} from the server itself (${a.error})`, `This test runs on the server and some servers cannot reach their own public address. Test from your own computer instead:  curl -sI ${base}${page_}`); }
    else {
      line(a.status === 200, a.status === 200 ? `${base}${page_} loads (200)` : `${base}${page_} answered ${a.status}, not 200`, "Nginx is not serving plugin pages yet. On the server run:  cd ~/vibepress-0.5.1 && sudo bash update.sh   (it adds the plugin settings to Nginx), then check this again.");
      if (a.status === 200) { const csp = String(a.headers["content-security-policy"] || ""), ok = /(^|[\s;])sandbox/.test(csp); line(ok, ok ? "Plugin pages are served with the browser sandbox" : "Plugin pages are served WITHOUT the browser sandbox header", "Nginx is missing the plugin settings. Run  sudo bash update.sh  from the VibePress folder, then check again. Until then, do not install plugins you do not fully trust."); }
    }
    const c = await get(base + "/x-api/" + p.id + "/selfcheck");
    if (c.error) line(false, `Could not reach ${base}/x-api/ from the server itself (${c.error})`, "Test from your own computer:  curl -sI " + base + "/x-api/" + p.id + "/selfcheck");
    else { const ok = c.status === 404 && /json/.test(String(c.headers["content-type"] || "")); line(ok, ok ? "The plugin data address (/x-api/) reaches the app" : `/x-api/ answered ${c.status} (${String(c.headers["content-type"] || "no type")}), not the app's own answer`, "Nginx is not passing /x-api/ to the app. Run  sudo bash update.sh  from the VibePress folder, then check again."); }
    return out;
  };
  admin.post("/check", verifyCsrf, async (req, res) => {
    const r = await siteCheck(), good = r.every(x => x.ok);
    res.send(page("Site check", `${h1("Does my website serve plugins?")}<p><a href="/admin/plugins/">&larr; Plugins</a></p>
${r.map(x => `<div class="pl" style="border-color:var(--${x.ok ? "green" : "red"})"><strong>${x.ok ? "&#10003;" : "&#9888;"} ${esc(x.what)}</strong>${x.ok ? "" : `<p style="margin:.3rem 0">${esc(x.fix)}</p>`}</div>`).join("")}
<p class="meta">${good ? "Everything a plugin page needs is in place. If you still see no change, remember a plugin only appears where you link to it: use <strong>Add to the menu</strong> or <strong>Add to the home page</strong> on its card." : "Fix the lines marked with a warning, then press the check again."}</p>`, { head: UI + CSS }));
  });
  admin.get("/check", (req, res) => res.redirect("/admin/plugins/"));
  admin.get("/diagnose", async (req, res) => {
    const p = ID.test(String(req.query.id)) && registry.get(req.query.id); if (!p) return res.redirect("/admin/plugins/");
    res.send(page("Setup check", `${h1(esc(p.name) + ": setup check")}<p><a href="/admin/plugins/">&larr; Plugins</a>${p.settings ? ` &middot; <a href="/admin/plugins/settings?id=${esc(p.id)}">Settings</a>` : ""}${p.permissions.includes("files:private") ? ` &middot; <a href="/admin/plugins/files?id=${esc(p.id)}">Files</a>` : ""}</p>${diagHtml(await diagnose(p))}`, { head: UI + CSS }));
  });
  admin.post("/toggle", verifyCsrf, (req, res) => {
    const p = ID.test(String(req.body.id)) && registry.get(req.body.id); if (!p) return res.redirect("/admin/plugins/");
    if (p.enabled) host.stop(p.id);
    registry.setEnabled(p.id, !p.enabled); res.redirect("/admin/plugins/?done=changed");
  });
  admin.get("/remove", (req, res) => {
    const p = ID.test(String(req.query.id)) && registry.get(req.query.id); if (!p) return res.redirect("/admin/plugins/");
    res.send(page("Remove plugin", `${h1("Remove " + esc(p.name) + "?")}<p>Its pages and code are deleted from your site.</p>
<form method="post" action="/admin/plugins/remove" class="wide">${hidden(req)}<input type="hidden" name="id" value="${esc(p.id)}">
<label style="display:block;margin:.6rem 0"><input type="checkbox" name="keep" value="1" checked style="width:auto"> Keep the data it collected (so it is still there if you install it again)</label>
<button class="danger">Yes, remove it</button></form><p><a href="/admin/plugins/">Cancel</a></p>`, { head: UI }));
  });
  admin.post("/remove", verifyCsrf, (req, res) => {
    const p = ID.test(String(req.body.id)) && registry.get(req.body.id); if (p) { host.stop(p.id); registry.remove(p.id, req.body.keep === "1"); }
    res.redirect("/admin/plugins/?done=removed");
  });
  admin.get("/export", (req, res) => {
    const p = ID.test(String(req.query.id)) && registry.get(req.query.id); const f = p && registry.packagePath(p.id);
    if (!p || !fs.existsSync(f)) return res.redirect("/admin/plugins/");
    res.download(f, `${p.id}-${p.version}.vpplugin`);
  });
  admin.get("/log", async (req, res) => {
    const p = ID.test(String(req.query.id)) && registry.get(req.query.id); if (!p) return res.redirect("/admin/plugins/");
    let live = "";
    if (p.hasServer && p.enabled) {                                           // start the server part (if needed) and ask it something: this shows at once whether the sandbox works here
      const t0 = Date.now();
      try { const out = await host.call(p.id, { method: "GET", path: "/__ping", query: {}, body: null, visitor: "admin" }); live = out ? `<p class="note" style="margin-top:0">&#10003; Live test: the plugin's server part started and answered in ${Date.now() - t0} ms.</p>` : ""; }
      catch (e) { live = `<p class="err">&#9888; Live test failed: ${esc(String(e.message).slice(0, 200))}</p><p class="meta">The server part of this plugin cannot run on this server. The messages below usually say why. You can also run <code>node -v</code> (server plugins need Node 22.13 or newer) and <code>node /var/www/vibepress/app/plugins/selftest.js</code> on the server.</p>`; }
    } else if (p.hasServer) live = '<p class="meta">The plugin is turned off, so its server part is not running.</p>';
    const st = host.status(p.id);
    res.send(page("Plugin status", `${h1(esc(p.name) + " status")}<p><a href="/admin/plugins/">&larr; Plugins</a></p>${live}
<p>Server part: <strong>${st.running ? "running" : "not running right now"}</strong> &middot; storage used: ${kb(pdata.usage(p.id))} of 2 MB</p>
<h3 class="cat">Recent messages from the plugin</h3><pre style="white-space:pre-wrap;word-break:break-word">${st.log.length ? esc(st.log.join("\n")) : "(nothing yet)"}</pre>`, { head: UI + CSS }));
  });

  const spec = req => { const p = ID.test(String(req.query.id || req.body.id)) && registry.get(req.query.id || req.body.id), c = String(req.query.c || req.body.c || ""); return p && p.collections && p.collections[c] ? { p, c, s: p.collections[c] } : null; };
  admin.get("/entries", (req, res) => {
    const x = spec(req); if (!x) return res.redirect("/admin/plugins/");
    const rows = pdata.all(x.p.id, x.c).slice(0, 200), f = Object.keys(x.s.fields), lab = x.s.labels || {};
    res.send(page("Entries", `${h1(esc(x.p.name) + ": " + esc(x.c))}<p><a href="/admin/plugins/">&larr; Plugins</a></p>
<p class="meta">${lab.on ? `Newest first. Use the buttons to switch an entry between "${esc(lab.on)}" and "${esc(lab.off || "waiting")}".` : (x.s.approval === "manual" ? "New entries wait here until you approve them." : "Entries show straight away; hide or delete any you do not want.") + " Newest first."}</p>
${rows.length ? rows.map(e => `<div class="pl"><p style="margin:.1rem 0">${f.map(k => e.v[k] === undefined ? "" : `<strong>${esc(k)}:</strong> ${esc(String(e.v[k]))}`).filter(Boolean).join("<br>")}</p><p class="meta" style="margin:.2rem 0">${esc(e.at.slice(0, 16).replace("T", " "))} &middot; ${e.approved ? esc(lab.on || "shown") : `<strong>${esc(lab.off || "waiting")}</strong>`}</p>
<div class="acts"><form class="inline" method="post" action="/admin/plugins/entry">${hidden(req)}<input type="hidden" name="id" value="${esc(x.p.id)}"><input type="hidden" name="c" value="${esc(x.c)}"><input type="hidden" name="e" value="${esc(e.id)}"><button name="do" value="${e.approved ? "hide" : "approve"}">${e.approved ? esc(lab.hide || "Hide") : esc(lab.approve || "Approve")}</button> <button class="danger" name="do" value="delete">Delete</button></form></div></div>`).join("") : "<p>No entries yet.</p>"}`, { head: UI + CSS }));
  });
  admin.post("/entry", verifyCsrf, (req, res) => {
    const x = spec(req); if (!x) return res.redirect("/admin/plugins/");
    const e = String(req.body.e || "");
    if (/^[a-f0-9]{10}$/.test(e)) { if (req.body.do === "delete") pdata.del(x.p.id, x.c, e); else pdata.setApproved(x.p.id, x.c, e, req.body.do === "approve"); }
    res.redirect(`/admin/plugins/entries?id=${x.p.id}&c=${x.c}`);
  });

  /* ---- settings page (built from the plugin's declared settings) ---- */
  const one = req => { const p = ID.test(String(req.query.id || req.body.id)) && registry.get(req.query.id || req.body.id); return p && p.settings ? p : null; };
  const parseSettings = (p, body) => {
    const sc = p.settings, fl = pdata.files.list(p.id), old = pdata.settings.get(p.id), errors = [], values = {}, lists = {}, raw = { values: {}, lists: {} };
    const isOn = (f, r) => f.type === "boolean" ? r === "1" : String(r === undefined ? "" : r).trim() !== "";
    for (const [k, f] of Object.entries(sc.fields)) { const r = body["f_" + k]; raw.values[k] = f.type === "boolean" ? r === "1" : String(r === undefined ? "" : r); const c = pdata.settings.checkValue(f, r, fl); if (c.error) errors.push(c.error); else if (c.value !== undefined) values[k] = c.value; }
    for (const [ln, l] of Object.entries(sc.lists)) {
      const n = Math.min(Math.max(parseInt(body[`l_${ln}_n`], 10) || 0, 0), l.max + 1), rows = [], rawRows = [], oldIds = new Set((old.lists[ln] || []).map(r => r.id));
      for (let i = 0; i < n; i++) {
        const pre = `l_${ln}_${i}_`; if (body[pre + "_del"] === "1") continue;
        const rr = {}, row = {}, errs = []; let any = false;
        for (const [k, f] of Object.entries(l.fields)) { const r = body[pre + k]; rr[k] = f.type === "boolean" ? r === "1" : String(r === undefined ? "" : r); if (isOn(f, r)) any = true; const c = pdata.settings.checkValue(f, r, fl); if (c.error) errs.push(c.error); else if (c.value !== undefined) row[k] = c.value; }
        if (!any) continue;                                                   // an untouched blank row
        errs.forEach(m => errors.push(`${l.label}, row ${rows.length + 1}: ${m}`));
        const bid = String(body[pre + "_id"] || ""); row.id = oldIds.has(bid) ? bid : pdata.settings.newRowId(); rr.id = row.id;
        rows.push(row); rawRows.push(rr);
      }
      if (rows.length > l.max) errors.push(`${l.label}: at most ${l.max} rows.`);
      lists[ln] = rows; raw.lists[ln] = rawRows;
    }
    return { values, lists, errors, raw };
  };
  const field = (name, f, v, fl) => {
    const val = v === undefined || v === null ? "" : v;
    let input;
    if (f.type === "boolean") input = `<input type="checkbox" name="${name}" value="1"${val === true ? " checked" : ""} style="width:auto">`;
    else if (f.type === "choice") input = `<select name="${name}"><option value=""></option>${f.options.map(o => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else if (f.type === "file") input = `<select name="${name}"><option value="">(choose a file)</option>${fl.map(r => `<option value="${esc(r.id)}"${r.id === val ? " selected" : ""}>${esc(r.name)} (${kb(r.size)})</option>`).join("")}${val && !fl.some(r => r.id === val) ? `<option value="${esc(val)}" selected>(file missing)</option>` : ""}</select>`;
    else if (f.type === "number") input = `<input type="number" step="any" name="${name}" min="${f.min}" max="${f.max}" value="${esc(val)}">`;
    else input = `<input name="${name}" maxlength="${f.max || 40}" value="${esc(val)}"${f.type === "decimal" ? ' inputmode="decimal" placeholder="e.g. 0.005" style="max-width:12rem"' : ""} autocomplete="off">`;
    return `<label style="display:block;margin:.6rem 0">${esc(f.label)}${f.required ? " *" : ""}${f.type === "boolean" ? " " : "<br>"}${input}</label>${f.help ? `<p class="meta" style="margin:0 0 .4rem">${esc(f.help)}</p>` : ""}${f.check && val ? '<p class="meta" style="margin:0 0 .4rem">&#10003; Format and checksum look right. Still compare it with your wallet, character by character.</p>' : ""}`;
  };
  const settingsView = (req, p, cur, errors, saved, diag) => {
    const fl = pdata.files.list(p.id);
    return page("Settings", `${h1(esc(p.name) + " settings")}<p><a href="/admin/plugins/">&larr; Plugins</a></p>
${errors && errors.length ? `<p class="err">Nothing was saved. Please fix:</p><ul class="err">${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}${saved ? '<p class="note" style="margin-top:0">Saved.</p>' : ""}${diag ? '<h3 class="cat">Setup check</h3>' + diag : ""}
<form method="post" action="/admin/plugins/settings" class="wide">${hidden(req)}<input type="hidden" name="id" value="${esc(p.id)}">
${Object.entries(p.settings.fields).map(([k, f]) => field("f_" + k, f, cur.values[k], fl)).join("")}
${Object.entries(p.settings.lists).map(([ln, l]) => { const rows = (cur.lists[ln] || []).slice(0, l.max); return `<h3 class="cat">${esc(l.label)}</h3><p class="meta">Up to ${l.max}. Fill in the empty box at the end to add one; tick Remove to delete one.</p><input type="hidden" name="l_${ln}_n" value="${rows.length + 1}">
${rows.concat([{}]).map((r, i) => `<div class="pl"><input type="hidden" name="l_${ln}_${i}__id" value="${esc(r.id || "")}">${Object.entries(l.fields).map(([k, f]) => field(`l_${ln}_${i}_${k}`, f, r[k], fl)).join("")}${r.id ? `<label style="display:block;margin:.4rem 0"><input type="checkbox" name="l_${ln}_${i}__del" value="1" style="width:auto"> Remove this one</label>` : '<p class="meta">(new)</p>'}</div>`).join("")}`; }).join("")}
<p style="margin-top:1rem"><button>Save settings</button></p></form>`, { head: UI + CSS });
  };
  admin.get("/settings", async (req, res) => { const p = one(req); if (!p) return res.redirect("/admin/plugins/"); const d = await diagnose(p); res.send(settingsView(req, p, pdata.settings.withDefaults(p.settings, pdata.settings.get(p.id)), [], req.query.saved === "1", d.none && !d.alive ? "" : diagHtml(d))); });
  admin.post("/settings", verifyCsrf, (req, res) => {
    const p = one(req); if (!p) return res.redirect("/admin/plugins/");
    const r = parseSettings(p, req.body);
    if (r.errors.length) return res.status(400).send(settingsView(req, p, r.raw, r.errors));
    pdata.settings.set(p.id, r.values, r.lists); res.redirect("/admin/plugins/settings?id=" + p.id + "&saved=1");
  });

  /* ---- private files ---- */
  const upDir = () => path.join(P.staging(), "uploads");
  const upFile = multer({ storage: multer.diskStorage({ destination: (q, f, cb) => { fs.mkdirSync(upDir(), { recursive: true, mode: 0o700 }); cb(null, upDir()); }, filename: (q, f, cb) => cb(null, crypto.randomBytes(8).toString("hex")) }), limits: { fileSize: pfiles.maxFileMB() * 1048576, files: 1 } });
  const withFiles = req => { const p = ID.test(String(req.query.id || req.body.id)) && registry.get(req.query.id || req.body.id); return p && p.permissions.includes("files:private") ? p : null; };
  const filesView = (req, p, msg, ok) => page("Files", `${h1(esc(p.name) + " files")}<p><a href="/admin/plugins/">&larr; Plugins</a></p>
${msg ? `<p class="err">${esc(msg)}</p>` : ""}${ok ? `<p class="note" style="margin-top:0">${esc(ok)}</p>` : ""}
<p class="meta">These files are kept private. They are never in your public web folder. The plugin can only hand out short-lived download links to them. Files up to ${pfiles.maxFileMB()} MB. Keep your own copy of every file: data backups do not include these files.</p>
<form method="post" action="/admin/plugins/files/upload" enctype="multipart/form-data" class="wide"><input type="hidden" name="id" value="${esc(p.id)}">${hidden(req)}
<label>Add a file<input type="file" name="file" required></label><button>Upload</button></form>
${pdata.files.list(p.id).map(r => `<div class="pl"><strong>${esc(r.name)}</strong> <span class="meta">${kb(r.size)} &middot; ${esc(r.at.slice(0, 10))}</span><br><span class="meta">SHA-256: <code style="word-break:break-all">${esc(r.sha256)}</code></span>
<div class="acts"><form class="inline" method="post" action="/admin/plugins/files/delete">${hidden(req)}<input type="hidden" name="id" value="${esc(p.id)}"><input type="hidden" name="f" value="${esc(r.id)}"><button class="danger">Delete</button></form></div></div>`).join("") || "<p class=\"meta\">No files yet.</p>"}`, { head: UI + CSS });
  admin.get("/files", (req, res) => { const p = withFiles(req); if (!p) return res.redirect("/admin/plugins/"); res.send(filesView(req, p, "", req.query.done === "1" ? "Done." : "")); });
  admin.post("/files/upload", (req, res, next) => upFile.single("file")(req, res, err => err ? res.status(400).send(`<p>That upload failed (files can be up to ${pfiles.maxFileMB()} MB).</p><p><a href="/admin/plugins/">Back</a></p>`) : next()), verifyCsrf, async (req, res) => {
    const p = withFiles(req); const tmp = req.file && req.file.path;
    if (!p || !tmp) { if (tmp) fs.rmSync(tmp, { force: true }); return res.redirect("/admin/plugins/"); }
    try { await pfiles.add(p.id, tmp, req.file.originalname); res.redirect("/admin/plugins/files?id=" + p.id + "&done=1"); }
    catch (e) { fs.rmSync(tmp, { force: true }); res.status(400).send(filesView(req, p, e.message)); }
  });
  admin.post("/files/delete", verifyCsrf, (req, res) => { const p = withFiles(req); if (p) pfiles.remove(p.id, String(req.body.f || "")); res.redirect(p ? "/admin/plugins/files?id=" + p.id + "&done=1" : "/admin/plugins/"); });
  return { admin, pub, _siteCheck: siteCheck };
};
