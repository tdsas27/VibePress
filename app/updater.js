/* Admin > Updates: check a GitHub repo for a newer release, or accept a release file uploaded by hand, then apply it.
   VibePress's own update.sh already does the real work (backup, copy files, npm install, rebuild, Nginx). This page only gets a
   verified copy of update.sh onto the server at one fixed path and, if the server owner has explicitly allowed it, runs it.

   No new privilege is granted by this code. The Node app runs as an ordinary user and still does. Running update.sh needs root
   (it edits Nginx and installs packages), so it can only be applied automatically if the owner has, in their own terminal, added a
   narrow sudoers rule naming this exact path and nothing else. Until they do, the page says precisely what to add and, for a
   manual release file, exactly what to run over SSH — nothing is run on the owner's behalf without that explicit, visible step. */
const express = require("express"), multer = require("multer"), fs = require("fs"), path = require("path"), https = require("https"), crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");
const { cmp, current: currentVersion } = require("./plugins/manifest"), cfg = require("./updateconfig"), UI = require("./ui");

module.exports = ({ page, h1, esc, hidden, verifyCsrf, run }) => {
  run = run || ((cmd, args, opts) => spawnSync(cmd, args, Object.assign({ encoding: "utf8", timeout: 8000 }, opts)));
  const VP_DIR = () => process.env.VIBEPRESS_DIR || "/var/www/vibepress";
  const STAGE = () => path.join(VP_DIR(), "update-staging"), INCOMING = () => path.join(STAGE(), "incoming");
  const TARGET = () => path.join(INCOMING(), "update.sh");                 // the one fixed path a sudoers rule can safely name
  const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
  const MAX_DOWNLOAD = 200 * 1048576;

  const sudoLine = () => `${process.env.USER || "www-data"} ALL=(root) NOPASSWD: ${TARGET()}`;
  const sudoReady = () => run("sudo", ["-n", "-l", "bash", TARGET()], { timeout: 5000 }).status === 0;

  /* ---------- GitHub: find the latest release and its VibePress asset ---------- */
  const httpsGetJson = (url, redirects = 5) => new Promise((resolve, reject) => {
    const u = new URL(url); if (u.protocol !== "https:") return reject(new Error("Only https addresses are used."));
    https.get(u, { headers: { "user-agent": "VibePress-updater", accept: "application/vnd.github+json" }, timeout: 10000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(httpsGetJson(new URL(res.headers.location, u).href, redirects - 1)); }
      const parts = []; let n = 0;
      res.on("data", c => { n += c.length; if (n > 2 * 1048576) { res.destroy(); reject(new Error("The answer was too large.")); } else parts.push(c); });
      res.on("end", () => { if (res.statusCode !== 200) return reject(new Error(`GitHub answered ${res.statusCode}${res.statusCode === 404 ? " (check the repository name)" : res.statusCode === 403 ? " (rate limited; try again in a while)" : ""}.`)); try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch { reject(new Error("GitHub's answer could not be read.")); } });
    }).on("timeout", function () { this.destroy(new Error("GitHub did not answer in time.")); }).on("error", reject);
  });
  const chooseAsset = assets => (Array.isArray(assets) ? assets : []).find(a => /^vibepress-[\d.]+\.zip$/.test(a.name)) || (Array.isArray(assets) ? assets : []).find(a => /\.zip$/.test(a.name));
  async function latestRelease(repo) {
    const data = await httpsGetJson(`https://api.github.com/repos/${repo}/releases/latest`);
    if (!data || !data.tag_name) throw new Error("That repository has no releases yet.");
    const version = String(data.tag_name).replace(/^v/i, ""), asset = chooseAsset(data.assets);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`The release tag "${data.tag_name}" is not a plain version number.`);
    if (!asset) throw new Error("That release has no .zip file attached.");
    return { version, url: asset.browser_download_url, size: asset.size, name: data.name || data.tag_name, notes: String(data.body || "").slice(0, 2000), page: data.html_url };
  }
  const download = (url, dest, redirects = 5) => new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error("Bad address.")); }
    if (u.protocol !== "https:") return reject(new Error("Only https addresses are used."));
    https.get(u, { headers: { "user-agent": "VibePress-updater" }, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(download(new URL(res.headers.location, u).href, dest, redirects - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download answered ${res.statusCode}.`)); }
      const out = fs.createWriteStream(dest, { mode: 0o600 }); let n = 0;
      res.on("data", c => { n += c.length; if (n > MAX_DOWNLOAD) { res.destroy(); out.destroy(); fs.rmSync(dest, { force: true }); reject(new Error(`The file is larger than ${MAX_DOWNLOAD / 1048576} MB.`)); } });
      res.pipe(out); out.on("finish", () => resolve()); out.on("error", reject);
    }).on("timeout", function () { this.destroy(new Error("The download timed out.")); }).on("error", reject);
  });

  /* ---------- opening a release zip safely into the one fixed INCOMING path ---------- */
  function stageZip(zipPath) {
    const dest = INCOMING();
    let names; try { names = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
    catch { throw new Error("That file is not a valid zip."); }
    if (names.length > 20000) throw new Error("That zip has far too many files to be a VibePress release.");
    for (const n of names) if (n.startsWith("/") || n.includes("\\") || n.split("/").includes("..") || n.includes("\0")) throw new Error(`The zip contains an unsafe path ("${n.slice(0, 60)}").`);
    fs.rmSync(STAGE(), { recursive: true, force: true }); fs.mkdirSync(STAGE(), { recursive: true, mode: 0o700 });
    const unpackTo = path.join(STAGE(), "unpack");
    try { execFileSync("unzip", ["-qq", zipPath, "-d", unpackTo], { timeout: 60000, stdio: "ignore" }); } catch { throw new Error("The zip could not be opened (is the \"unzip\" program installed?)."); }
    let base = unpackTo;
    const top = fs.readdirSync(unpackTo).filter(n => fs.statSync(path.join(unpackTo, n)).isDirectory());
    if (!fs.existsSync(path.join(base, "update.sh")) && top.length === 1) base = path.join(unpackTo, top[0]);   // allow one wrapping folder, as GitHub's zips always add
    for (const must of ["update.sh", "VERSION", path.join("app", "package.json")]) if (!fs.existsSync(path.join(base, must))) throw new Error(`This does not look like a VibePress release (missing ${must}).`);
    let version = ""; try { version = JSON.parse(fs.readFileSync(path.join(base, "app", "package.json"), "utf8")).version; } catch {}
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("The release's own version number could not be read.");
    fs.rmSync(dest, { recursive: true, force: true }); fs.renameSync(base, dest); fs.rmSync(unpackTo, { recursive: true, force: true });
    fs.chmodSync(path.join(dest, "update.sh"), 0o700);
    return version;
  }
  const applyStaged = () => run("sudo", ["-n", "bash", TARGET()], { timeout: 20 * 60000 });

  /* ---------- the page ---------- */
  const current = currentVersion();
  const view = (req, { msg, ok, release, applyResult } = {}) => {
    const c = cfg.read(), repo = c.repo || "", ready = fs.existsSync(TARGET()), canSudo = ready && sudoReady();
    return page("Updates", `${h1("Updates")}<p><a href="/admin/">&larr; Dashboard</a></p>
<p class="meta">This checks a GitHub repository's releases, or accepts a release file you upload yourself. Either way, you review what was found before anything is applied, and applying it runs the same update.sh you would run over SSH &mdash; nothing more.</p>
${msg ? `<p class="${ok ? "note" : "err"}" style="margin-top:0">${esc(msg)}</p>` : ""}
<p>Running version: <strong>${esc(current)}</strong></p>
<h3 class="cat">Check GitHub for a new release</h3>
<form method="post" action="/admin/updates/repo" class="row" style="border:0">${hidden(req)}<input name="repo" placeholder="owner/repository" value="${esc(repo)}" style="max-width:20rem"><button>Save</button></form>
${repo ? `<form method="post" action="/admin/updates/check">${hidden(req)}<button>Check ${esc(repo)} for updates</button></form>` : '<p class="meta">Enter the GitHub repository above (for example <code>your-name/vibepress</code>) and press Save.</p>'}
${release ? releaseBox(req, release, canSudo, ready) : ""}
${applyResult ? applyBox(applyResult) : ""}
<h3 class="cat">Or upload a release file</h3>
<form method="post" action="/admin/updates/upload" enctype="multipart/form-data"><label>Release .zip (from a GitHub release, or one I gave you)<input type="file" name="file" accept=".zip" required></label>${hidden(req)}<button>Upload</button></form>
${ready && !release ? stagedBox(req, canSudo) : ""}
<h3 class="cat">One-click apply (optional)</h3>
<p class="meta">${canSudo ? "&#10003; This server is set up for one-click updates." : "By default nothing is run for you automatically. To allow the button above to apply a staged update by itself, run <code>sudo visudo</code> on the server and add exactly this line, which permits only this one fixed script and nothing else:"}</p>
${canSudo ? "" : `<pre style="white-space:pre-wrap;word-break:break-word">${esc(sudoLine())}</pre><p class="meta">Without that line, a staged update is never applied automatically: the page tells you the exact command to run over SSH instead.</p>`}`, { head: UI });
  };
  const releaseBox = (req, r, canSudo, ready) => `<div class="pl"><h4>${r.behind ? "An update is available: " : "You already have the latest: "}${esc(r.version)}</h4>
${r.notes ? `<p class="meta" style="white-space:pre-wrap">${esc(r.notes.slice(0, 500))}</p>` : ""}
${r.behind ? `<form method="post" action="/admin/updates/fetch">${hidden(req)}<input type="hidden" name="token" value="${esc(r.token)}"><button>Download and stage ${esc(r.version)}</button></form>` : ""}</div>`;
  const stagedBox = (req, canSudo) => { let v = ""; try { v = JSON.parse(fs.readFileSync(path.join(INCOMING(), "app", "package.json"), "utf8")).version; } catch {}
    return `<div class="pl"><h4>Staged and ready: version ${esc(v || "?")}</h4>${canSudo ? `<form method="post" action="/admin/updates/apply">${hidden(req)}<button>Apply this update now</button></form>` : `<p>Run this over SSH to apply it:</p><pre>sudo bash ${esc(TARGET())}</pre>`}</div>`; };
  const applyBox = r => `<div class="pl" style="border-color:var(--${r.status === 0 ? "green" : "red"})"><h4>${r.status === 0 ? "&#10003; Update applied" : "&#9888; The update did not finish"}</h4><pre style="white-space:pre-wrap;word-break:break-word;max-height:20rem;overflow:auto">${esc(String((r.stdout || "") + (r.stderr || "")).slice(-4000))}</pre></div>`;

  const admin = express.Router();
  const tokens = new Map();                                              // short-lived: ties a Check result to the Fetch button so the browser can't invent a download URL
  admin.get("/", (req, res) => res.send(view(req, {})));
  admin.post("/repo", verifyCsrf, (req, res) => {
    const repo = String(req.body.repo || "").trim();
    if (repo && !REPO_RE.test(repo)) return res.status(400).send(view(req, { msg: 'That should look like "owner/repository".' }));
    cfg.write({ repo }); res.redirect("/admin/updates/");
  });
  admin.post("/check", verifyCsrf, async (req, res) => {
    const repo = (cfg.read().repo || "").trim();
    if (!REPO_RE.test(repo)) return res.status(400).send(view(req, { msg: "Set a repository first." }));
    try {
      const r = await latestRelease(repo), behind = cmp(current, r.version) < 0;
      const token = crypto.randomBytes(8).toString("hex"); tokens.set(token, { url: r.url, version: r.version }); setTimeout(() => tokens.delete(token), 15 * 60000).unref();
      res.send(view(req, { release: Object.assign({ behind, token }, r) }));
    } catch (e) { res.status(502).send(view(req, { msg: "Could not check for updates: " + e.message })); }
  });
  admin.post("/fetch", verifyCsrf, async (req, res) => {
    const t = tokens.get(String(req.body.token)); if (!t) return res.status(400).send(view(req, { msg: "That check has expired. Press Check again." }));
    fs.mkdirSync(STAGE(), { recursive: true, mode: 0o700 }); const zip = path.join(STAGE(), "download.zip");
    try { await download(t.url, zip); const got = stageZip(zip); res.send(view(req, { ok: true, msg: `Staged version ${got}. Review it below.` })); }
    catch (e) { res.status(502).send(view(req, { msg: "Could not stage that update: " + e.message })); }
    finally { fs.rmSync(zip, { force: true }); }
  });
  const up = multer({ storage: multer.diskStorage({ destination: (q, f, cb) => { fs.mkdirSync(STAGE(), { recursive: true, mode: 0o700 }); cb(null, STAGE()); }, filename: (q, f, cb) => cb(null, "upload-" + crypto.randomBytes(6).toString("hex") + ".zip") }), limits: { fileSize: MAX_DOWNLOAD, files: 1 } });
  admin.post("/upload", (req, res, next) => up.single("file")(req, res, err => err ? res.status(400).send(view(req, { msg: "That upload failed (up to " + (MAX_DOWNLOAD / 1048576) + " MB)." })) : next()), verifyCsrf, (req, res) => {
    if (!req.file) return res.status(400).send(view(req, { msg: "Choose a file first." }));
    try { const got = stageZip(req.file.path); res.send(view(req, { ok: true, msg: `Staged version ${got}. Review it below.` })); }
    catch (e) { res.status(400).send(view(req, { msg: e.message })); }
    finally { fs.rmSync(req.file.path, { force: true }); }
  });
  admin.post("/apply", verifyCsrf, (req, res) => {
    if (!fs.existsSync(TARGET())) return res.status(400).send(view(req, { msg: "Nothing is staged yet." }));
    if (!sudoReady()) return res.status(400).send(view(req, { msg: "This server is not set up for one-click updates yet (see the line to add below)." }));
    const r = applyStaged(); res.send(view(req, { applyResult: r }));
  });
  return { admin, _latestRelease: latestRelease, _stageZip: stageZip, _sudoReady: sudoReady, _sudoLine: sudoLine, _target: TARGET };
};
