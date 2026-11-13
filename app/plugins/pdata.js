/* Each plugin's own data: a small key/value store and "collections" (lists of validated entries). Nothing here is shared between plugins. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), P = require("./paths");
const LIM = { total: 2 * 1048576, value: 65536, keys: 500 };
const validators = require("./validators");
const cache = new Map(), KEY = /^[\w.:-]{1,64}$/;
const f = id => path.join(P.store(), id + ".json");
const load = id => { if (!cache.has(id)) { let d = {}; try { d = JSON.parse(fs.readFileSync(f(id), "utf8")); } catch {} d.kv = d.kv || {}; d.col = d.col || {}; cache.set(id, d); } return cache.get(id); };
const save = id => { const d = cache.get(id), s = JSON.stringify(d); if (Buffer.byteLength(s) > LIM.total) throw new Error("This plugin has used up its storage allowance."); fs.mkdirSync(P.store(), { recursive: true, mode: 0o700 }); const t = f(id) + ".tmp"; fs.writeFileSync(t, s, { mode: 0o600 }); fs.renameSync(t, f(id)); };
const guarded = (id, fn) => { const d = load(id), before = JSON.stringify(d); try { const r = fn(d); save(id); return r; } catch (e) { cache.set(id, JSON.parse(before)); throw e; } };   // roll back if it did not fit

exports.kv = {
  get: (id, k) => { if (!KEY.test(k)) throw new Error("Bad key."); const v = load(id).kv[k]; return v === undefined ? null : JSON.parse(v); },
  set: (id, k, v) => { if (!KEY.test(k)) throw new Error("Keys are 1-64 letters, digits, . : _ or -."); const s = JSON.stringify(v === undefined ? null : v); if (Buffer.byteLength(s) > LIM.value) throw new Error("Value is larger than 64 KB."); return guarded(id, d => { if (!(k in d.kv) && Object.keys(d.kv).length >= LIM.keys) throw new Error("Too many keys (limit 500)."); d.kv[k] = s; return true; }); },
  delete: (id, k) => guarded(id, d => { delete d.kv[k]; return true; }),
  list: (id, prefix = "") => Object.keys(load(id).kv).filter(k => k.startsWith(String(prefix))).slice(0, 500)
};

/* ---- collections: the manifest declares fields; the host checks every entry, so plugin code is not needed ---- */
exports.check = (spec, body, partial) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send a JSON object." };
  const v = {};
  for (const [k, fd] of Object.entries(spec.fields)) {
    let x = body[k];
    if (partial && x === undefined) continue;
    if (x === undefined || x === null || x === "") { if (fd.required && !partial) return { error: `"${k}" is required.` }; if (partial && x === "") v[k] = ""; continue; }
    if (fd.type === "string") { if (typeof x !== "string") return { error: `"${k}" must be text.` }; x = x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim(); if (!x && fd.required) return { error: `"${k}" is required.` }; if (x.length > fd.max) return { error: `"${k}" can be at most ${fd.max} characters.` }; }
    else if (fd.type === "number") { x = typeof x === "string" && x.trim() !== "" ? Number(x) : x; if (typeof x !== "number" || !Number.isFinite(x) || x < fd.min || x > fd.max) return { error: `"${k}" must be a number from ${fd.min} to ${fd.max}.` }; }
    else if (fd.type === "boolean") { if (typeof x !== "boolean") return { error: `"${k}" must be true or false.` }; }
    else if (fd.type === "choice") { if (!fd.options.includes(x)) return { error: `"${k}" must be one of: ${fd.options.join(", ")}.` }; }
    v[k] = x;
  }
  return { values: v };
};
exports.add = (id, name, spec, values) => guarded(id, d => {
  const list = d.col[name] = d.col[name] || [];
  list.push(Object.assign({ id: crypto.randomBytes(5).toString("hex"), at: new Date().toISOString(), approved: spec.approval === "auto" }, { v: values }));
  while (list.length > spec.maxItems) list.shift();
  return list[list.length - 1].approved;
});
exports.publicList = (id, name, limit = 50) => (load(id).col[name] || []).filter(e => e.approved).slice(-Math.min(Math.max(limit, 1), 100)).reverse().map(e => Object.assign({ id: e.id, at: e.at }, e.v));
exports.all = (id, name) => (load(id).col[name] || []).slice().reverse();
exports.setApproved = (id, name, eid, on) => guarded(id, d => { const e = (d.col[name] || []).find(x => x.id === eid); if (e) e.approved = !!on; return !!e; });
exports.del = (id, name, eid) => guarded(id, d => { d.col[name] = (d.col[name] || []).filter(x => x.id !== eid); return true; });
exports.counts = (id, name) => { const l = load(id).col[name] || []; return { total: l.length, pending: l.filter(e => !e.approved).length }; };
exports.wipe = id => { cache.delete(id); fs.rmSync(f(id), { force: true }); };
exports.usage = id => Buffer.byteLength(JSON.stringify(load(id)));

/* ---------- server-side access to a plugin's own collections (vp.data) ---------- */
const flat = e => Object.assign({ id: e.id, at: e.at, approved: !!e.approved }, e.v);
const need = (spec, name) => { if (!spec) throw new Error(`There is no collection called "${name}".`); };
exports.srv = {
  add: (id, name, spec, body, approved) => { need(spec, name); const c = exports.check(spec, body); if (c.error) throw new Error(c.error);
    return guarded(id, d => { const list = d.col[name] = d.col[name] || []; const e = { id: crypto.randomBytes(5).toString("hex"), at: new Date().toISOString(), approved: !!approved, v: c.values }; list.push(e); while (list.length > spec.maxItems) list.shift(); return flat(e); }); },
  find: (id, name, spec, field, value) => { need(spec, name); if (field !== "id" && !spec.fields[field]) throw new Error(`Unknown field "${String(field).slice(0, 30)}".`);
    const l = load(id).col[name] || []; for (let i = l.length - 1; i >= 0; i--) { const e = l[i]; if ((field === "id" ? e.id : e.v[field]) === value) return flat(e); } return null; },
  update: (id, name, spec, eid, body) => { need(spec, name); const c = exports.check(spec, body, true); if (c.error) throw new Error(c.error);
    return guarded(id, d => { const e = (d.col[name] || []).find(x => x.id === eid); if (!e) return null; Object.assign(e.v, c.values); for (const k of Object.keys(e.v)) if (e.v[k] === "") delete e.v[k]; return flat(e); }); },
  setApproved: (id, name, spec, eid, on) => { need(spec, name); return guarded(id, d => { const e = (d.col[name] || []).find(x => x.id === eid); if (!e) return null; e.approved = !!on; return flat(e); }); },
  list: (id, name, spec, opts) => { need(spec, name); const o = opts || {}, n = Math.min(Math.max(parseInt(o.limit, 10) || 50, 1), 200);
    return (load(id).col[name] || []).filter(e => o.approved === undefined || e.approved === !!o.approved).slice(-n).reverse().map(flat); }
};

/* ---------- the owner's settings (filled in on the plugin's settings page) ---------- */
const DEC = /^\d{1,9}(\.\d{1,18})?$/, RID = /^[a-f0-9]{10}$/;
exports.DEC = DEC;
exports.settings = {
  get: id => { const s = load(id).settings || { values: {}, lists: {} }; return { values: Object.assign({}, s.values), lists: JSON.parse(JSON.stringify(s.lists || {})) }; },
  withDefaults: (schema, cur) => { const v = Object.assign({}, cur.values); for (const [k, f] of Object.entries(schema.fields || {})) if (v[k] === undefined && f.default !== undefined) v[k] = f.default; return { values: v, lists: cur.lists || {} }; },
  /* Checks one value from the settings form. Returns { value } or { error }. */
  checkValue: (f, raw, files) => {
    const label = f.label;
    if (f.type === "boolean") return { value: raw === "1" || raw === true };
    let x = raw === undefined || raw === null ? "" : String(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (x === "") { if (f.required) return { error: `${label} is required.` }; return { value: undefined }; }
    if (f.type === "string") { if (x.length > f.max) return { error: `${label} can be at most ${f.max} characters.` }; if (f.check) { const ok = validators[f.check](x); if (!ok) return { error: `${label} does not look like a valid ${f.check.split("-")[0].toUpperCase()} address. Check it for typos.` }; x = ok; } return { value: x }; }
    if (f.type === "number") { const n = Number(x); if (!Number.isFinite(n) || n < f.min || n > f.max) return { error: `${label} must be a number from ${f.min} to ${f.max}.` }; return { value: n }; }
    if (f.type === "choice") return f.options.includes(x) ? { value: x } : { error: `${label}: choose one of the listed options.` };
    if (f.type === "decimal") return DEC.test(x) ? { value: x.replace(/^0+(?=\d)/, "") } : { error: `${label} must be a plain number like 5 or 0.0025.` };
    if (f.type === "file") return files.some(r => r.id === x) ? { value: x } : { error: `${label}: choose one of your uploaded files.` };
    return { error: `${label}: unsupported field.` };
  },
  set: (id, values, lists) => guarded(id, d => { d.settings = { values, lists }; return true; }),
  newRowId: () => crypto.randomBytes(5).toString("hex"), isRowId: x => RID.test(String(x))
};

/* ---------- private files: an index only; the bytes live outside the web folder (see files.js) ---------- */
exports.files = {
  list: id => Object.entries(load(id).files || {}).map(([fid, r]) => Object.assign({ id: fid }, r)).sort((a, b) => b.at.localeCompare(a.at)),
  get: (id, fid) => { const r = (load(id).files || {})[fid]; return r ? Object.assign({ id: fid }, r) : null; },
  add: (id, fid, rec) => guarded(id, d => { d.files = d.files || {}; d.files[fid] = rec; return true; }),
  del: (id, fid) => guarded(id, d => { if (d.files) delete d.files[fid]; if (d.grants) for (const [h, g] of Object.entries(d.grants)) if (g.f === fid) delete d.grants[h]; return true; })
};

/* ---------- short-lived download links: only a hash of the token is stored ---------- */
const hashTok = t => crypto.createHash("sha256").update(String(t)).digest("hex");
exports.grants = {
  create: (id, fid, ttlSec, uses) => { const token = crypto.randomBytes(24).toString("base64url"), now = Date.now();
    guarded(id, d => { d.grants = d.grants || {}; for (const [h, g] of Object.entries(d.grants)) if (g.x < now || g.u < 1) delete d.grants[h]; if (Object.keys(d.grants).length >= 300) throw new Error("Too many open download links."); d.grants[hashTok(token)] = { f: fid, x: now + ttlSec * 1000, u: uses }; return true; });
    return { token, expires: now + ttlSec * 1000 }; },
  use: (id, token) => { let fid = null; const h = hashTok(token);
    guarded(id, d => { const g = (d.grants || {})[h]; if (g && g.x >= Date.now() && g.u >= 1) { g.u -= 1; fid = g.f; if (g.u < 1) delete d.grants[h]; } return true; });
    return fid; }
};
