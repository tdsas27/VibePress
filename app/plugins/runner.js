/* Runs INSIDE the sandbox (a separate Node process started by host.js with --permission: no files outside the plugin folder,
   no child processes, no workers, no native code, no eval, no fetch). Plugin code is loaded by the small loader below, which only
   hands out a few harmless Node modules and files from the plugin's own folder. It talks to VibePress only through vp.* messages. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const send = process.send.bind(process);
const codeDir = fs.realpathSync(process.argv[2]), serverRel = process.argv[3];
const SAFE = { crypto: require("crypto"), util: require("util"), path, url: require("url"), events: require("events"), querystring: require("querystring"), string_decoder: require("string_decoder"), buffer: require("buffer"), assert: require("assert") };

const cache = new Map();
function load(file) {                                                    // tiny CommonJS loader, confined to codeDir
  if (cache.has(file)) return cache.get(file).exports;
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".json")) { const m = { exports: JSON.parse(text) }; cache.set(file, m); return m.exports; }
  const mod = { exports: {} }; cache.set(file, mod);
  const req = name => {
    const bare = String(name).replace(/^node:/, "");
    if (Object.prototype.hasOwnProperty.call(SAFE, bare)) return SAFE[bare];
    if (!/^\.{1,2}[\\/]/.test(name)) throw new Error(`Module "${name}" is not available to VibePress plugins.`);
    const base = path.resolve(path.dirname(file), name);
    for (const c of [base, base + ".js", base + ".json", path.join(base, "index.js")]) {
      let real; try { real = fs.realpathSync(c); } catch { continue; }
      if (!fs.statSync(real).isFile()) continue;
      if (!real.startsWith(codeDir + path.sep)) throw new Error("A plugin can only load its own files.");
      return load(real);
    }
    throw new Error(`Cannot find "${name}".`);
  };
  const fn = vm.compileFunction(text, ["exports", "require", "module", "__filename", "__dirname"], { filename: file });   // no importModuleDynamically: import() fails
  fn.call(mod.exports, mod.exports, req, mod, file, path.dirname(file));
  return mod.exports;
}

/* ---- talking to the host ---- */
let seq = 0; const waiting = new Map();
const api = (fn, args = []) => new Promise((ok, no) => {
  const id = ++seq, t = setTimeout(() => { waiting.delete(id); no(new Error("VibePress did not answer in time.")); }, 12000);
  waiting.set(id, { ok, no, t }); send({ t: "api", id, fn, args });
});
const routes = [];
const vp = Object.freeze({
  route(method, p, handler) {
    if (!/^(GET|POST)$/.test(method) || typeof p !== "string" || !/^\/[\w\-/:.]*$/.test(p) || typeof handler !== "function") throw new Error('vp.route("GET" or "POST", "/path", async (req) => ({ json: ... }))');
    routes.push({ method, parts: p.split("/").filter(Boolean), handler });
  },
  kv: Object.freeze({ get: k => api("kv.get", [k]), set: (k, v) => api("kv.set", [k, v]), delete: k => api("kv.delete", [k]), list: p => api("kv.list", [p || ""]) }),
  pages: Object.freeze({ list: () => api("pages.list") }),
  site: Object.freeze({ get: () => api("site.get") }),
  settings: Object.freeze({ get: () => api("settings.get") }),
  files: Object.freeze({ list: () => api("files.list"), grant: (id, o) => api("files.grant", [String(id), o || {}]) }),
  data: Object.freeze({ add: (c, v, o) => api("data.add", [String(c), v, o || {}]), find: (c, f, v) => api("data.find", [String(c), String(f), v]), update: (c, id, v) => api("data.update", [String(c), String(id), v]), approve: (c, id, on) => api("data.approve", [String(c), String(id), !!on]), list: (c, o) => api("data.list", [String(c), o || {}]) }),
  fetch: async (u, o) => { const r = await api("fetch", [String(u), o && o.timeout ? Math.floor(Number(o.timeout)) || 0 : 0]); return { status: r.status, text: r.text, json: () => JSON.parse(r.text) }; },
  log: (...a) => console.log(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 300))
});

function match(method, parts) {
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params = {}; let ok = true;
    r.parts.forEach((s, i) => { if (s.startsWith(":")) params[s.slice(1)] = parts[i]; else if (s !== parts[i]) ok = false; });
    if (ok) return { r, params };
  }
  return null;
}
process.on("message", async m => {
  if (!m || typeof m !== "object") return;
  if (m.t === "apires") { const w = waiting.get(m.id); if (w) { clearTimeout(w.t); waiting.delete(m.id); m.ok ? w.ok(m.value) : w.no(new Error(String(m.error).slice(0, 200))); } return; }
  if (m.t !== "req") return;
  try {
    const hit = match(m.req.method, String(m.req.path).split("/").filter(Boolean));
    if (!hit) return send({ t: "res", id: m.id, ok: true, value: { status: 404, json: { error: "Not found" } } });
    const out = await hit.r.handler(Object.assign({}, m.req, { params: hit.params }));
    send({ t: "res", id: m.id, ok: true, value: out && typeof out === "object" ? out : { text: String(out ?? "") } });
  } catch (e) { send({ t: "res", id: m.id, ok: false, error: String(e && e.message || e).slice(0, 200) }); }
});
process.on("disconnect", () => process.exit(0));
process.on("uncaughtException", e => { console.log("uncaught: " + String(e && e.stack || e).slice(0, 300)); process.exit(1); });
process.on("unhandledRejection", e => { console.log("unhandled: " + String(e && e.stack || e).slice(0, 300)); });

/* Lock the door before any plugin code runs. */
for (const k of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "Request", "Response", "Headers", "FormData", "BroadcastChannel", "MessageChannel", "MessagePort", "WebAssembly", "SharedArrayBuffer", "Atomics"]) { try { delete globalThis[k]; } catch {} }
for (const k of ["binding", "dlopen", "mainModule", "_linkedBinding", "report", "stdin"]) { try { Object.defineProperty(process, k, { value: undefined, configurable: false }); } catch {} }

try {
  const entry = fs.realpathSync(path.join(codeDir, serverRel));
  if (!entry.startsWith(codeDir + path.sep)) throw new Error("bad server path");
  const init = load(entry);
  (typeof init === "function" ? init : init && init.default)(vp);
  send({ t: "ready", routes: routes.map(r => r.method + " /" + r.parts.join("/")) });
} catch (e) { console.log("failed to start: " + String(e && e.message || e).slice(0, 300)); process.exit(1); }

