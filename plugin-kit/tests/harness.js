// Shared test setup: loads the real plugin system (sandbox, storage, files, package checks) behind a tiny stand-in for Express and
// multer, so the admin and public routes can be exercised without starting a web server.
const Module = require("module"), fs = require("fs"), os = require("os"), path = require("path");
const APP = path.join(__dirname, "..", "..", "app");

function Router() {
  const stack = [];
  const r = { stack,
    use(a, ...f) { const p = typeof a === "string" ? a : ""; const fns = typeof a === "string" ? f : [a, ...f]; stack.push({ m: null, p, fns, use: true }); return r; },
    get: (p, ...f) => { stack.push({ m: "GET", p, fns: f }); return r; }, post: (p, ...f) => { stack.push({ m: "POST", p, fns: f }); return r; } };
  r.handle = async (req, res) => {
    const base = req.path;
    const run = async (fns, i = 0) => { if (i >= fns.length) return; const f = fns[i]; if (f.length === 4) return run(fns, i + 1);
      const go = await new Promise((ok, no) => { try { const rv = f(req, res, e => e ? no(e) : ok(true)); if (rv && rv.then) rv.then(() => ok(false), no); else if (res.sent) ok(false); } catch (e) { no(e); } });
      if (go) return run(fns, i + 1); };
    for (const l of stack) {
      if (res.sent) break;
      if (l.use) { const keys = []; const re = new RegExp("^" + l.p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "(/.*|$)"); const m = base.match(re); if (!m) continue;
        keys.forEach((k, i) => (req.params = req.params || {})[k] = m[i + 1]); const saved = req.path; req.path = m[keys.length + 1] || "/";
        await run(l.fns).catch(e => { const eh = stack.find(s => s.use && s.fns[0].length === 4); if (eh) eh.fns[0](e, req, res, () => {}); else throw e; }); req.path = saved; }
      else if (l.m === req.method) { const re = new RegExp("^" + l.p.replace(/:(\w+)/g, "([^/]+)") + "$"); if (re.test(base)) { await run(l.fns); break; } }
    }
    if (!res.sent) { res.status(404); res.send("NOT FOUND"); }
  };
  return r;
}
const express = Object.assign(() => ({}), { Router, json: () => (req, res, next) => next() });
const multer = Object.assign(() => ({ single: () => (req, res, next) => next() }), { memoryStorage: () => ({}), diskStorage: () => ({}) });
const orig = Module._load;
Module._load = function (r, ...a) { if (r === "express") return express; if (r === "multer") return multer; return orig.call(this, r, ...a); };

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

exports.load = function (extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vp-test-"));
  process.env.VP_DATA_DIR = tmp + "/data"; process.env.SITE_DIR = tmp + "/site"; process.env.SESSION_SECRET = "x".repeat(40); process.env.VP_ROOT = path.join(APP, ".."); process.env.BRAND_FILE = tmp + "/brand.json"; process.env.TEMPLATES_DIR = path.join(APP, "..", "templates"); process.env.SITE_URL = "https://example.com";
  fs.copyFileSync(path.join(APP, "..", "config", "brand.example.json"), tmp + "/brand.json");
  const mod = require(APP + "/plugins")(Object.assign({ page: (t, b) => `<html>${b}</html>`, h1: t => `<h1>${t}</h1>`, esc, hidden: () => "", verifyCsrf: (q, s, n) => n(), listPages: () => [], siteInfo: () => ({ name: "Test site", url: "https://example.com" }) }, extra || {}));
  const call = async (router, method, p, { body = {}, query = {}, file = null, headers = {} } = {}) => {
    const res = { sent: false, code: 200, hdr: {}, body: "", loc: null, dl: null, status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === "object") Object.assign(this.hdr, k); else this.hdr[k] = v; return this; }, type(t) { this.hdr["content-type"] = t; return this; },
      send(b) { this.body = b; this.sent = true; return this; }, json(o) { this.body = JSON.stringify(o); this.sent = true; return this; }, redirect(l) { this.loc = l; this.sent = true; }, cookie(n, v, o) { (this.cookies = this.cookies || {})[n] = { value: v, opts: o }; return this; }, clearCookie(n) { (this.cookies = this.cookies || {})[n] = null; return this; }, sendStatus(c) { this.code = c; this.sent = true; }, download(f, n) { this.dl = [f, n]; this.sent = true; } };
    await router.handle({ method, path: p, body, query, file, headers: { "x-real-ip": "9.9.9.9", ...headers }, socket: { remoteAddress: "1.1.1.1" } }, res); return res; };
  return { tmp, mod, call, A: (m, p, o) => call(mod.admin, m, p, o), P: (m, p, o) => call(mod.pub, m, p, o),
    registry: require(APP + "/plugins/registry"), host: require(APP + "/plugins/host"), pdata: require(APP + "/plugins/pdata"), pfiles: require(APP + "/plugins/files"), pkg: require(APP + "/plugins/package"), manifest: require(APP + "/plugins/manifest"),
    cleanup() { require(APP + "/plugins/host").stopAll(); fs.rmSync(tmp, { recursive: true, force: true }); } };
};
exports.zip = require("../zip");
exports.makeCounter = () => { let pass = 0, fail = 0; return { ok(n, c, x) { c ? pass++ : fail++; console.log((c ? "  PASS  " : "  FAIL  ") + n + (c ? "" : "  -> " + String(x).slice(0, 240))); }, done() { console.log(`\n${pass} passed, ${fail} failed.\n`); return fail ? 1 : 0; } }; };
