/* VibePress plugin manifest: the one file that says what a plugin is and what it may do. */
const fs = require("fs"), path = require("path");
const ID = /^[a-z][a-z0-9-]{2,29}$/, VER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/, NAME = /^[a-z][a-z0-9_]{0,23}$/;
const RESERVED = new Set(["admin", "api", "x", "x-api", "shared", "blog", "apps", "links", "feedback", "games", "tools", "other", "uploads", "downloads", "support", "get", "go", "scripts", "vibepress", "plugin", "plugins"]);
const FIELD_TYPES = new Set(["string", "number", "boolean", "choice"]);

// The running version. app/package.json always travels with the app; the VERSION file at the top of the package is only a fallback.
const PLATFORM = "0.5.1";
const current = () => {
  for (const f of [["..", "package.json"], ["..", "..", "VERSION"]]) {
    try { const t = fs.readFileSync(path.join(__dirname, ...f), "utf8"), v = f[1] === "package.json" ? JSON.parse(t).version : t.trim(); if (/^\d+\.\d+\.\d+$/.test(String(v))) return v; } catch { /* try the next place */ }
  }
  return PLATFORM;
};
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };

/* Plain-English description of every permission an admin is asked to approve. */
const describePerm = p => p === "pages:read" ? "See the titles and addresses of your published pages"
  : p === "site:read" ? "See your site name and address"
  : p === "files:private" ? "Keep private files that you upload, and give visitors short-lived download links (the plugin can never read or change the files themselves)"
  : p.startsWith("net:") ? `Make requests from your server to ${p.slice(4)} (https only; nothing else on the internet)` : p;

const SETTING_TYPES = new Set(["string", "number", "boolean", "choice", "decimal", "file"]), CHECKS = new Set(["btc-address", "eth-address", "ton-address"]);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b), plain = (x, n) => String(x).replace(/[<>"]/g, "").slice(0, n);
function settingFields(f, where, e) {                                    // fields for the owner's settings page (and rows of its lists)
  const out = {};
  if (!f || typeof f !== "object" || Array.isArray(f) || !Object.keys(f).length || Object.keys(f).length > 25) { e(`${where} needs 1-25 fields.`); return out; }
  for (const [k, s] of Object.entries(f)) {
    if (!NAME.test(k) || k === "id" || !s || !SETTING_TYPES.has(s.type)) { e(`${where}: bad field "${k.slice(0, 30)}" (types: string, number, boolean, choice, decimal, file).`); continue; }
    const o = { type: s.type, label: plain(s.label || k, 60), help: s.help ? plain(s.help, 200) : "", required: !!s.required };
    if (s.type === "string") { o.max = clamp(parseInt(s.max, 10) || 200, 1, 1000); if (s.check !== undefined) { if (!CHECKS.has(s.check)) { e(`${where}, field "${k}": unknown check "${plain(s.check, 30)}".`); continue; } o.check = s.check; } if (s.default !== undefined) o.default = String(s.default).slice(0, o.max); }
    if (s.type === "number") { o.min = Number.isFinite(s.min) ? s.min : -1e9; o.max = Number.isFinite(s.max) ? s.max : 1e9; if (Number.isFinite(s.default)) o.default = s.default; }
    if (s.type === "boolean" && typeof s.default === "boolean") o.default = s.default;
    if (s.type === "choice") { if (!Array.isArray(s.options) || !s.options.length || s.options.length > 20 || s.options.some(x => typeof x !== "string" || x.length > 60)) { e(`${where}, field "${k}": "options" must be a list of up to 20 short texts.`); continue; } o.options = s.options; if (s.default !== undefined && s.options.includes(s.default)) o.default = s.default; }
    out[k] = o;
  }
  return out;
}

function validate(m, version = current()) {
  const errors = [], e = s => errors.push(s);
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, errors: ["plugin.json must contain a JSON object."] };
  const str = (k, max, req = true) => { const v = m[k]; if (v === undefined || v === "") { if (req) e(`"${k}" is required.`); return ""; } if (typeof v !== "string" || v.length > max) { e(`"${k}" must be text of ${max} characters or fewer.`); return ""; } return v.trim(); };
  const c = { id: str("id", 30), name: str("name", 60), version: str("version", 12), author: str("author", 60), description: str("description", 300), license: str("license", 30, false), vibepress: str("vibepress", 12, false) || "0.0.0" };
  if (c.id && (!ID.test(c.id) || RESERVED.has(c.id))) e(`"id" must be 3-30 lowercase letters, digits or hyphens, start with a letter, and not be a reserved word.`);
  if (c.version && !VER.test(c.version)) e(`"version" must look like 1.0.0.`);
  if (!VER.test(c.vibepress)) e(`"vibepress" must look like 0.2.0 (the oldest VibePress this plugin works with).`);
  else if (cmp(c.vibepress, version) > 0) e(`This plugin needs VibePress ${c.vibepress} or newer (this site runs ${version}).`);

  c.timeout = 3;
  if (m.timeout !== undefined) { if (!Number.isInteger(m.timeout) || m.timeout < 3 || m.timeout > 10) e(`"timeout" must be a whole number of seconds from 3 to 10.`); else c.timeout = m.timeout; }

  c.permissions = [];
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions) || m.permissions.length > 8) e(`"permissions" must be a list of up to 8 items.`);
    else for (const p of m.permissions) {
      if (p === "pages:read" || p === "site:read" || p === "files:private") c.permissions.push(p);
      else if (typeof p === "string" && /^net:[a-z0-9][a-z0-9.-]{2,98}[a-z0-9]$/.test(p) && p.includes(".") && !/^net:[\d.]+$/.test(p) && !/localhost|\.local$|\.internal$/.test(p)) c.permissions.push(p);
      else e(`Unknown or unsafe permission "${String(p).slice(0, 60)}". Allowed: pages:read, site:read, files:private, net:<public hostname>.`);
    }
    c.permissions = [...new Set(c.permissions)];
  }

  c.pages = [];
  if (m.pages !== undefined) {
    if (!Array.isArray(m.pages) || m.pages.length > 10) e(`"pages" must be a list of up to 10 pages.`);
    else for (const p of m.pages) {
      if (!p || typeof p.title !== "string" || !p.title.trim() || p.title.length > 60 || typeof p.path !== "string" || !/^[\w\-./]{1,100}\.html$/.test(p.path) || p.path.includes("..") || p.path.startsWith("/")) e(`Each page needs a "title" and a "path" like index.html (inside the public folder).`);
      else c.pages.push({ title: p.title.trim().replace(/[<>"]/g, ""), path: p.path });
    }
  }

  c.server = "";
  if (m.server !== undefined && m.server !== "") {
    if (typeof m.server !== "string" || !/^[\w\-./]{1,80}\.js$/.test(m.server) || m.server.includes("..") || m.server.startsWith("/") || m.server.startsWith("public/")) e(`"server" must be a .js file outside the public folder, like server.js.`);
    else c.server = m.server;
  }

  c.collections = {};
  if (m.collections !== undefined) {
    const cs = m.collections;
    if (!cs || typeof cs !== "object" || Array.isArray(cs) || Object.keys(cs).length > 5) e(`"collections" must be an object with up to 5 collections.`);
    else for (const [name, spec] of Object.entries(cs)) {
      if (!NAME.test(name)) { e(`Collection name "${name.slice(0, 30)}" must be lowercase letters, digits or underscores.`); continue; }
      const f = spec && spec.fields, fields = {};
      if (!f || typeof f !== "object" || !Object.keys(f).length || Object.keys(f).length > 20) { e(`Collection "${name}" needs 1-20 fields.`); continue; }
      for (const [fn, fs_] of Object.entries(f)) {
        if (!NAME.test(fn) || ["id", "at", "approved"].includes(fn) || !fs_ || !FIELD_TYPES.has(fs_.type)) { e(`Collection "${name}": bad field "${fn.slice(0, 30)}" (types: string, number, boolean, choice).`); continue; }
        const o = { type: fs_.type, required: !!fs_.required };
        if (fs_.type === "string") o.max = Math.min(Math.max(parseInt(fs_.max, 10) || 200, 1), 1000);
        if (fs_.type === "number") { o.min = Number.isFinite(fs_.min) ? fs_.min : -1e9; o.max = Number.isFinite(fs_.max) ? fs_.max : 1e9; }
        if (fs_.type === "choice") { if (!Array.isArray(fs_.options) || !fs_.options.length || fs_.options.length > 20 || fs_.options.some(x => typeof x !== "string" || x.length > 60)) { e(`Collection "${name}", field "${fn}": "options" must be a list of up to 20 short texts.`); continue; } o.options = fs_.options; }
        fields[fn] = o;
      }
      const lb = {}; if (spec.labels && typeof spec.labels === "object") for (const k of ["on", "off", "approve", "hide"]) if (typeof spec.labels[k] === "string") lb[k] = plain(spec.labels[k], 24);
      c.collections[name] = { labels: lb, fields, approval: spec.approval === "auto" ? "auto" : "manual", publicRead: spec.publicRead !== false, publicWrite: spec.publicWrite !== false, maxItems: Math.min(Math.max(parseInt(spec.maxItems, 10) || 500, 1), 2000) };
    }
  }
  c.settings = null;
  if (m.settings !== undefined) {
    const st = m.settings;
    if (!st || typeof st !== "object" || Array.isArray(st)) e(`"settings" must be an object with "fields" and/or "lists".`);
    else {
      const out = { fields: {}, lists: {} };
      if (st.fields !== undefined) out.fields = settingFields(st.fields, "settings.fields", e);
      if (st.lists !== undefined) {
        if (!st.lists || typeof st.lists !== "object" || Array.isArray(st.lists) || Object.keys(st.lists).length > 3) e(`"settings.lists" must be an object with up to 3 lists.`);
        else for (const [ln, l] of Object.entries(st.lists)) {
          if (!NAME.test(ln) || !l || typeof l !== "object") { e(`Bad list name "${ln.slice(0, 30)}".`); continue; }
          out.lists[ln] = { label: plain(l.label || ln, 60), max: clamp(parseInt(l.max, 10) || 20, 1, 100), fields: settingFields(l.fields, `settings list "${ln}"`, e) };
        }
      }
      if (!Object.keys(out.fields).length && !Object.keys(out.lists).length) e(`"settings" is empty.`); else c.settings = out;
    }
  }
  if (c.settings && Object.values(c.settings.lists).some(l => Object.values(l.fields).some(f => f.type === "file")) || c.settings && Object.values(c.settings.fields).some(f => f.type === "file")) { if (!c.permissions.includes("files:private")) e(`A "file" setting needs the "files:private" permission.`); }
  if (!c.pages.length && !c.server && !Object.keys(c.collections).length) e(`A plugin needs at least one page, collection or server file.`);
  return { ok: !errors.length, errors, manifest: c };
}
module.exports = { validate, describePerm, cmp, current, ID, RESERVED };
