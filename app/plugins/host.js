/* The host side: starts each server plugin in its own restricted Node process, passes requests in, checks every call the plugin makes back. */
const { fork, spawnSync } = require("child_process"), path = require("path"), https = require("https"), dns = require("dns"), net = require("net");
const registry = require("./registry"), pdata = require("./pdata");
const RUNNER = path.join(__dirname, "runner.js");
const MAXFETCH = 524288, tmo = e => ((e && e.timeout) || 3) * 1000;

/* Which Node.js options can the sandbox use on THIS server? Node changes its options between versions (for example Node 24 dropped
   --no-experimental-fetch), so each one is tried before it is relied on, and the complete command line is tried at the end.
   Fetch and WebSocket are removed by the runner itself before any plugin code runs, so the optional options are only an extra layer. */
function chooseFlags(run) {                                              // run(args) -> { status, stderr }; injectable so it can be tested
  const info = { flags: null, error: "" }, ok = a => { const r = run(a); return r && r.status === 0; };
  const perm = ["--permission", "--experimental-permission"].find(f => ok([f]));
  if (!perm) { info.error = "This Node.js has no permission model (server plugins need Node 22.13 or newer)."; return info; }
  const optional = ["--no-experimental-fetch", "--no-experimental-websocket"].filter(f => ok([f]));
  for (const heap of [64, 96, 128]) {
    const flags = [perm, "--max-old-space-size=" + heap, ...optional, "--disallow-code-generation-from-strings", "--no-warnings"], r = run(flags);
    if (r && r.status === 0) { info.flags = flags; info.error = ""; return info; }
    info.error = String((r && (r.stderr || r.error)) || "").trim().split("\n")[0].slice(0, 200);
  }
  return info;
}
let sandbox;
const probe = () => sandbox || (sandbox = Object.assign({ node: process.version }, chooseFlags(args => spawnSync(process.execPath, [...args, "-e", "process.exit(0)"], { timeout: 8000, env: {}, encoding: "utf8" }))));
exports.sandboxAvailable = () => !!probe().flags;
exports.sandboxInfo = () => probe();
exports._chooseFlags = chooseFlags;

const privateIp = ip => {
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)); }
  const s = ip.toLowerCase(); const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return privateIp(m[1]);
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
};
/* Step 1 of every plugin fetch: is this address allowed at all? Runs first no matter how the request is then sent. */
const checkUrl = (urlStr, hosts) => {
  let u; try { u = new URL(urlStr); } catch { throw new Error("Bad address."); }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) throw new Error("Only plain https addresses are allowed.");
  if (!hosts.includes(u.hostname)) throw new Error(`This plugin did not ask for permission to contact ${u.hostname}.`);
  return u;
};
/* Step 2: send it. Never to private or internal addresses (checked when connecting, so DNS tricks do not help), no redirects, capped size and time. */
const sendRequest = (u, ms) => new Promise((ok, no) => {
  const lookup = (host, opts, cb) => dns.lookup(host, { all: !!(opts && opts.all) }, (e, a, f) => {
    if (e) return cb(e);
    const list = Array.isArray(a) ? a : [{ address: a, family: f }];
    if (list.some(x => privateIp(x.address))) return cb(new Error("That address points inside a private network."));
    Array.isArray(a) ? cb(null, list) : cb(null, a, f);
  });
  const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, lookup, timeout: ms || 8000, headers: { "user-agent": "VibePress-Plugin/1", accept: "application/json, text/*" } }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return no(new Error("Redirects are not followed.")); }
    const parts = []; let n = 0;
    res.on("data", c => { n += c.length; if (n > MAXFETCH) { req.destroy(); no(new Error("The response was too large.")); } else parts.push(c); });
    res.on("end", () => ok({ status: res.statusCode, text: Buffer.concat(parts).toString("utf8") }));
  });
  req.on("timeout", () => req.destroy(new Error("The request timed out."))); req.on("error", no);
});

const running = new Map();                                               // id -> live process state
const hist = new Map(), H = id => { if (!hist.has(id)) hist.set(id, { crashes: [], log: [] }); return hist.get(id); };   // survives restarts
let deps = { listPages: () => [], siteInfo: () => ({}), fetch: null };   // fetch can be replaced in tests, but the address checks (checkUrl) always run first
exports.configure = d => { deps = Object.assign(deps, d); };

function apiCall(entry, fn, args) {                                      // every call a plugin makes comes through here and is checked
  const id = entry.id, has = p => entry.permissions.includes(p);
  switch (fn) {
    case "kv.get": return pdata.kv.get(id, String(args[0]));
    case "kv.set": return pdata.kv.set(id, String(args[0]), args[1]);
    case "kv.delete": return pdata.kv.delete(id, String(args[0]));
    case "kv.list": return pdata.kv.list(id, String(args[0] || ""));
    case "pages.list": if (!has("pages:read")) throw new Error("Needs the pages:read permission."); return deps.listPages();
    case "site.get": if (!has("site:read")) throw new Error("Needs the site:read permission."); return deps.siteInfo();
    case "fetch": { const hosts = entry.permissions.filter(p => p.startsWith("net:")).map(p => p.slice(4)); if (!hosts.length) throw new Error("Needs a net:<host> permission."); const cap = Math.max(1500, tmo(entry) - 800), want = Math.floor(Number(args[1])) || 0; const u = checkUrl(String(args[0]), hosts); return (deps.fetch || ((url, h, ms) => sendRequest(u, ms)))(u.href, hosts, want >= 500 ? Math.min(want, cap) : cap); }
    case "settings.get": return pdata.settings.withDefaults(entry.settings || { fields: {} }, pdata.settings.get(id));
    case "files.list": if (!has("files:private")) throw new Error("Needs the files:private permission."); return pdata.files.list(id).map(f => ({ id: f.id, name: f.name, size: f.size, sha256: f.sha256 }));
    case "files.grant": { if (!has("files:private")) throw new Error("Needs the files:private permission."); const o = args[1] && typeof args[1] === "object" ? args[1] : {};
      const fid = String(args[0]); if (!pdata.files.get(id, fid)) throw new Error("There is no such file.");
      const g = pdata.grants.create(id, fid, Math.min(Math.max(parseInt(o.ttl, 10) || 600, 30), 3600), Math.min(Math.max(parseInt(o.uses, 10) || 1, 1), 10));
      return { url: `/x-api/${id}/dl/${g.token}`, expires: g.expires }; }
    case "data.add": { const sp = (entry.collections || {})[String(args[0])]; return pdata.srv.add(id, String(args[0]), sp, args[1], args[2] && args[2].approved); }
    case "data.find": { const sp = (entry.collections || {})[String(args[0])]; return pdata.srv.find(id, String(args[0]), sp, String(args[1]), args[2]); }
    case "data.update": { const sp = (entry.collections || {})[String(args[0])]; return pdata.srv.update(id, String(args[0]), sp, String(args[1]), args[2]); }
    case "data.approve": { const sp = (entry.collections || {})[String(args[0])]; return pdata.srv.setApproved(id, String(args[0]), sp, String(args[1]), args[2]); }
    case "data.list": { const sp = (entry.collections || {})[String(args[0])]; return pdata.srv.list(id, String(args[0]), sp, args[1]); }
    default: throw new Error("Unknown call.");
  }
}

function start(id) {
  const entry = registry.get(id);
  if (!entry || !entry.enabled || !entry.hasServer) throw new Error("This plugin has no running server part.");
  if (!probe().flags) throw new Error("The server sandbox is not available on this server" + (probe().error ? " (" + probe().error + ")" : "") + ".");
  const dir = registry.codeDir(id);
  const st = { pending: new Map(), log: H(id).log, ready: false, seq: 0 };
  const child = fork(RUNNER, [dir, entry.server], {
    execArgv: [...probe().flags, `--allow-fs-read=${RUNNER}`, `--allow-fs-read=${dir}`],
    env: {}, cwd: dir, stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "json", windowsHide: true
  });
  st.child = child;
  const note = d => { for (const l of String(d).split("\n").filter(Boolean)) { st.log.push(new Date().toISOString().slice(11, 19) + " " + l.slice(0, 300)); if (st.log.length > 40) st.log.shift(); } };
  child.stdout.on("data", note); child.stderr.on("data", note);
  st.readyP = new Promise((ok, no) => { st.ok = ok; st.no = no; setTimeout(() => no(new Error("The plugin did not start in time.")), 4000); });
  st.readyP.catch(() => {});
  child.on("message", async m => {
    if (!m || typeof m !== "object") return;
    if (m.t === "ready") { st.ready = true; st.ok(); }
    else if (m.t === "res") { const p = st.pending.get(m.id); if (p) { st.pending.delete(m.id); clearTimeout(p.t); m.ok ? p.ok(m.value) : p.no(new Error(String(m.error))); } }
    else if (m.t === "api" && Number.isInteger(m.id) && Array.isArray(m.args) && m.args.length <= 3) {
      try { const value = await apiCall(registry.get(id) || entry, String(m.fn), m.args); child.connected && child.send({ t: "apires", id: m.id, ok: true, value: value === undefined ? null : value }); }
      catch (e) { child.connected && child.send({ t: "apires", id: m.id, ok: false, error: String(e.message).slice(0, 200) }); }
    }
  });
  child.on("exit", () => {
    if (running.get(id) === st) running.delete(id);
    st.no && st.no(new Error("The plugin stopped."));
    for (const p of st.pending.values()) { clearTimeout(p.t); p.no(new Error("The plugin stopped.")); }
    st.pending.clear();
    if (st.killedByUs) return;
    const c = H(id).crashes, now = Date.now(); c.push(now);
    while (c.length && now - c[0] > 300000) c.shift();
    if (c.length >= 5) { registry.setEnabled(id, false, "It stopped unexpectedly 5 times in 5 minutes, so it was switched off."); c.length = 0; }
  });
  running.set(id, st);
  return st;
}

exports.call = async (id, req) => {                                      // req = { method, path, query, body, visitor }
  let st = running.get(id) || start(id);
  await st.readyP;
  return new Promise((ok, no) => {
    const lim = tmo(registry.get(id)), mid = ++st.seq, t = setTimeout(() => { st.pending.delete(mid); if (running.get(id) === st) running.delete(id); st.child.kill("SIGKILL"); no(Object.assign(new Error("The plugin took too long and was restarted."), { status: 504 })); }, lim);
    st.pending.set(mid, { ok, no, t });
    st.child.send({ t: "req", id: mid, req });
  });
};
exports.stop = id => { const st = running.get(id); if (st && st.child) { st.killedByUs = true; st.child.kill("SIGKILL"); } running.delete(id); };
exports.stopAll = () => { for (const id of [...running.keys()]) exports.stop(id); };
exports.status = id => { const st = running.get(id); return { running: !!(st && st.child && st.child.connected), log: H(id).log.slice() }; };
process.on("exit", exports.stopAll);
exports._privateIp = privateIp;
