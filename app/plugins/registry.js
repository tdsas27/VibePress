/* The list of installed plugins (data/plugins.json) and the install / enable / disable / remove steps. */
const fs = require("fs"), path = require("path"), P = require("./paths");
const file = () => path.join(P.data(), "plugins.json");
const read = () => { try { const d = JSON.parse(fs.readFileSync(file(), "utf8")); return Array.isArray(d) ? d : []; } catch { return []; } };
const write = d => { fs.mkdirSync(P.data(), { recursive: true }); const t = file() + ".tmp"; fs.writeFileSync(t, JSON.stringify(d, null, 2), { mode: 0o600 }); fs.renameSync(t, file()); };
const norm = (p, mode) => { for (const d of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, d.name); if (d.isDirectory()) { fs.chmodSync(f, 0o755); norm(f); } else fs.chmodSync(f, 0o644); } };
const copyTree = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true, dereference: false }); fs.chmodSync(to, 0o755); norm(to); };

exports.list = read;
exports.get = id => read().find(p => p.id === id) || null;
const url = (id, p) => "/x/" + id + "/" + (p === "index.html" ? "" : p);
exports.pageUrl = url;

function publish(id) {                                                    // copy public/ to the web folder
  const pub = path.join(P.root(), id, "code", "public"), dest = P.served(id);
  fs.rmSync(dest, { recursive: true, force: true });
  if (fs.existsSync(pub)) { copyTree(pub, dest + ".new"); fs.renameSync(dest + ".new", dest); }
}
exports.install = ({ base, manifest: m, hash, zipPath, granted }) => {
  const dir = path.join(P.root(), m.id);
  copyTree(base, path.join(dir, "code"));
  fs.copyFileSync(zipPath, path.join(dir, "package.vpplugin")); fs.chmodSync(path.join(dir, "package.vpplugin"), 0o644);
  publish(m.id);
  const all = read().filter(p => p.id !== m.id), prev = read().find(p => p.id === m.id);
  const entry = { id: m.id, name: m.name, version: m.version, author: m.author, description: m.description, permissions: granted, hasServer: !!m.server, server: m.server, collections: m.collections, settings: m.settings, timeout: m.timeout, pages: m.pages.map(p => ({ title: p.title, url: url(m.id, p.path) })), enabled: true, hash, installedAt: new Date().toISOString(), previousVersion: prev ? prev.version : undefined };
  all.push(entry); all.sort((a, b) => a.name.localeCompare(b.name)); write(all); return entry;
};
exports.setEnabled = (id, on, reason) => {
  const all = read(), p = all.find(x => x.id === id); if (!p) return false;
  p.enabled = !!on; if (on) delete p.disabledReason; else if (reason) p.disabledReason = reason;
  write(all);
  if (on) publish(id); else fs.rmSync(P.served(id), { recursive: true, force: true });
  return true;
};
exports.remove = (id, keepData) => {
  write(read().filter(p => p.id !== id));
  fs.rmSync(path.join(P.root(), id), { recursive: true, force: true });
  fs.rmSync(P.served(id), { recursive: true, force: true });
  if (!keepData) { require("./pdata").wipe(id); fs.rmSync(path.join(P.files(), id), { recursive: true, force: true }); }
};
exports.codeDir = id => path.join(P.root(), id, "code");
exports.packagePath = id => path.join(P.root(), id, "package.vpplugin");
