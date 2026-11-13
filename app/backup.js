/* Backup and restore: "data" (posts, links, feedback, firewall, image list) or "full" (public site folder incl. uploads + data).
   Backups are .tar.gz files kept outside the web folder; restore never deletes files, it only overwrites matching ones. */
const fs = require("fs"), path = require("path"), os = require("os"), express = require("express"), multer = require("multer");
const { spawn } = require("child_process");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const APP = __dirname, DATA = path.join(APP, "data"), SITE = process.env.SITE_DIR || "/var/www/vibepress/site";
  const BDIR = process.env.BACKUP_DIR || path.join(APP, "backups");
  fs.mkdirSync(BDIR, { recursive: true, mode: 0o700 });
  const NAME = /^[A-Za-z0-9._-]+\.tar\.gz$/;
  const up = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const mb = b => (b / 1048576).toFixed(1) + " MB";
  const date = t => new Date(t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const run = args => new Promise((ok, no) => {
    const p = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] }); let e = "";
    p.stderr.on("data", d => e += d); p.on("error", no);
    p.on("close", c => (c === 0 || c === 1) ? ok() : no(new Error(e.slice(0, 300) || "tar failed")));   // 1 = a file changed while reading, fine
  });
  const list = () => fs.readdirSync(BDIR).filter(n => NAME.test(n)).map(n => { const s = fs.statSync(path.join(BDIR, n)); return { n, size: s.size, t: s.mtimeMs }; }).sort((a, b) => b.t - a.t);

  const make = async (kind, withLogin, prefix = "tds") => {
    const name = `${prefix}-${kind}${withLogin ? "-login" : ""}-${stamp()}.tar.gz`, out = path.join(BDIR, name);
    const entries = fs.readdirSync(DATA).filter(n => !n.endsWith(".tmp") && !["plugin-files", "plugin-staging"].includes(n) && (withLogin || n !== "admin.json"));   // login file only when asked
    if (!entries.length && kind === "data") throw new Error("There is no data to back up yet.");
    const args = ["-czf", out, "--transform", "s,^\\./,site/,"];
    if (kind !== "data") { if (kind === "full") args.push("--exclude=./downloads"); args.push("-C", SITE, "."); }
    if (entries.length) args.push("-C", APP, ...entries.map(n => "data/" + n));
    await run(args); fs.chmodSync(out, 0o600); return name;
  };
  const restore = async file => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tds-restore-"));
    try {
      await run(["-xzf", file, "-C", tmp, "--no-same-owner", "--no-same-permissions"]);
      const top = fs.readdirSync(tmp);
      if (!top.length || top.some(t => !["site", "data"].includes(t))) throw new Error("This does not look like a VibePress backup.");
      const hasLink = d => fs.readdirSync(d, { withFileTypes: true }).some(e => e.isSymbolicLink() || (e.isDirectory() && hasLink(path.join(d, e.name))));
      if (hasLink(tmp)) throw new Error("The backup contains links, so it was refused.");
      await make(top.includes("site") ? "full" : "data", true, "prerestore");                  // undo copy of the current state
      if (top.includes("site")) fs.cpSync(path.join(tmp, "site"), SITE, { recursive: true, force: true });
      if (top.includes("data")) fs.cpSync(path.join(tmp, "data"), DATA, { recursive: true, force: true });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  };

  const admin = express.Router();
  const view = (req, msg) => page("Backup", `${h1("Backup")}<p><a href="/admin/">&larr; Dashboard</a></p>${msg ? `<p class="err">${esc(msg)}</p>` : ""}
<p class="meta"><strong>Data only</strong> = posts, links, feedback, firewall rules, image list (small and quick). <strong>Entire site</strong> = the public site folder with uploaded images, plus the data. App download files are left out unless you choose "Everything" because they can be large. A data backup is made automatically every day (the last 7 are kept).</p>
<form class="wide" method="post" action="/admin/backup/create">${hidden(req)}
<label>What to back up<select name="kind"><option value="data">Data only</option><option value="full">Entire site + data (without app download files)</option><option value="everything">Everything, including app download files (can be large)</option></select></label>
<label><select name="login"><option value="">Leave out my admin login file (recommended)</option><option value="1">Include my admin login file (contains my 2FA secret; keep the download private)</option></select></label><button>Create backup now</button></form>
<h3 class="cat">Saved backups</h3>${list().map(b => `<div class="row"><strong>${esc(b.n)}</strong><span class="meta">${mb(b.size)} | ${date(b.t)}</span><a href="/admin/backup/download/${esc(b.n)}">Download</a><a href="/admin/backup/restore/${esc(b.n)}">Restore</a><a href="/admin/backup/delete/${esc(b.n)}">Delete</a></div>`).join("") || '<p class="note">No backups yet.</p>'}
<h3 class="cat">Restore from a file on your computer</h3>
<form class="wide" method="post" action="/admin/backup/upload" enctype="multipart/form-data">${hidden(req)}
<label>Backup file (.tar.gz made by this page)<input type="file" name="backup" accept=".gz,.tar.gz" required></label>
<label>Type RESTORE to confirm<input name="confirm" autocomplete="off" required></label><button class="danger">Restore from this file</button></form>
<p class="meta">Restoring overwrites files that are in the backup and leaves other files alone. A safety copy of the current state is saved first, and the app restarts afterward.</p>`, { head: require("./ui") });
  const done = (req, res) => { res.send(page("Restored", `${h1("Restored")}<p>The backup was restored. The app is restarting, so give it a few seconds, then <a href="/admin/backup/">reload this page</a>. A safety copy of the previous state was saved as a "prerestore" backup.</p>`)); res.on("finish", () => setTimeout(() => process.exit(0), 500)); };
  const okName = n => NAME.test(String(n)) && fs.existsSync(path.join(BDIR, String(n)));

  admin.get("/", (req, res) => res.send(view(req)));
  admin.post("/create", verifyCsrf, async (req, res) => {
    try { await make(["full", "everything"].includes(req.body.kind) ? req.body.kind : "data", req.body.login === "1"); res.redirect("/admin/backup/"); }
    catch (e) { res.status(500).send(view(req, "Backup failed: " + e.message)); }
  });
  admin.get("/download/:n", (req, res) => okName(req.params.n) ? res.download(path.join(BDIR, req.params.n)) : res.redirect("/admin/backup/"));
  admin.get("/delete/:n", (req, res) => okName(req.params.n) ? res.send(page("Delete backup", `${h1("Delete this backup?")}<p>${esc(req.params.n)}</p><form method="post" action="/admin/backup/delete">${hidden(req)}<input type="hidden" name="n" value="${esc(req.params.n)}"><button class="danger">Yes, delete it</button></form><p><a href="/admin/backup/">Cancel</a></p>`, { head: require("./ui") })) : res.redirect("/admin/backup/"));
  admin.post("/delete", verifyCsrf, (req, res) => { if (okName(req.body.n)) fs.unlinkSync(path.join(BDIR, req.body.n)); res.redirect("/admin/backup/"); });
  admin.get("/restore/:n", (req, res) => okName(req.params.n) ? res.send(page("Restore", `${h1("Restore this backup?")}<p>${esc(req.params.n)}</p><p class="meta">Files in the backup overwrite the current ones. A safety copy of the current state is saved first.</p><form method="post" action="/admin/backup/restore">${hidden(req)}<input type="hidden" name="n" value="${esc(req.params.n)}"><label>Type RESTORE to confirm<input name="confirm" autocomplete="off" required></label><button class="danger">Restore</button></form><p><a href="/admin/backup/">Cancel</a></p>`, { head: require("./ui") })) : res.redirect("/admin/backup/"));
  admin.post("/restore", verifyCsrf, async (req, res) => {
    if (req.body.confirm !== "RESTORE" || !okName(req.body.n)) return res.status(400).send(view(req, "Type RESTORE exactly to confirm."));
    try { await restore(path.join(BDIR, req.body.n)); done(req, res); } catch (e) { res.status(500).send(view(req, "Restore failed: " + e.message)); }
  });
  admin.post("/upload", up.single("backup"), verifyCsrf, async (req, res) => {
    const f = req.file;
    try {
      if (!f) return res.status(400).send(view(req, "Please choose a backup file."));
      if (req.body.confirm !== "RESTORE" || !/\.tar\.gz$/i.test(f.originalname)) return res.status(400).send(view(req, "Choose a .tar.gz backup and type RESTORE exactly."));
      await restore(f.path); done(req, res);
    } catch (e) { res.status(500).send(view(req, "Restore failed: " + e.message)); }
    finally { if (f) fs.rm(f.path, { force: true }, () => {}); }
  });

  const start = () => {                                           // daily automatic data backup, keeping the newest 7
    const tick = async () => {
      const auto = () => list().filter(b => b.n.startsWith("auto-"));
      if (auto()[0] && Date.now() - auto()[0].t < 23 * 3600e3) return;
      try { await make("data", false, "auto"); } catch (e) { console.error("backup: " + e.message); }
      auto().slice(7).forEach(b => fs.unlinkSync(path.join(BDIR, b.n)));
    };
    setTimeout(tick, 60000).unref(); setInterval(tick, 6 * 3600e3).unref();
  };
  return { admin, start };
};
