/* App store: public list /apps/, detail /apps/<slug>, counted downloads /get/<id>, manager at /admin/apps/.
   Release files are saved in DOWNLOAD_DIR (served by Nginx at /downloads/) with a SHA-256 checksum. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), express = require("express"), multer = require("multer");
const store = require("./store"), UI = require("./ui"), imgutil = require("./imgutil");

module.exports = ({ page, h1, esc, hidden, verifyCsrf, ld, SITE_URL }) => {
  const FILE = "apps.json", DL = process.env.DOWNLOAD_DIR || "/var/www/vibepress/site/downloads", MAXMB = +process.env.MAX_APP_MB || 600;
  fs.mkdirSync(DL, { recursive: true });
  const EXT = /\.(apk|aab|zip|7z|exe|msi|dmg|pkg|deb|rpm|appimage|tgz|tar\.gz|ipa)$/i;
  const upImg = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1048576, files: 1 } });
  const up = multer({ limits: { fileSize: MAXMB * 1048576, files: 1 }, fileFilter: (req, f, cb) => cb(null, EXT.test(f.originalname)),
    storage: multer.diskStorage({ destination: DL, filename: (req, f, cb) => cb(null, crypto.randomBytes(4).toString("hex") + "-" + path.basename(f.originalname).replace(/[^\w.-]/g, "_").slice(-80)) }) });
  const all = () => store.read(FILE), clip = (s, n) => String(s || "").trim().slice(0, n);
  const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const PLATS = { win: ["Windows", "🪟", ["exe", "msi", "zip", "7z"]], mac: ["macOS", "🍎", ["dmg", "pkg", "zip"]], linux: ["Linux", "🐧", ["deb", "rpm", "appimage", "tgz", "tar.gz", "zip", "7z"]],
    android: ["Android", "🤖", ["apk", "aab", "zip"]], tv: ["Google TV", "📺", ["apk", "aab", "zip"]], ios: ["iOS", "📱", ["ipa", "zip"]] };
  const ORDER = Object.keys(PLATS);
  const extOf = n => /\.tar\.gz$/i.test(n) ? "tar.gz" : String(n).split(".").pop().toLowerCase();
  const pk = f => f.platform || ORDER.find(k => extOf(f.file) !== "zip" && PLATS[k][2].includes(extOf(f.file))) || "";
  const PLAT = f => pk(f) ? PLATS[pk(f)][0] : "Download";
  const PICON = f => pk(f) ? PLATS[pk(f)][1] : "⬇";
  const byPlat = r => r.files.slice().sort((a, b) => ORDER.indexOf(pk(a)) - ORDER.indexOf(pk(b)));
  const size = b => b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB";
  const date = t => new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const COLORS = ["var(--red)", "var(--orange)", "var(--yellow)", "var(--green)", "var(--blue)", "var(--purple)"];
  const iconOk = s => !s || s.length <= 8 || /^\/uploads\/[\w.-]+$/.test(s) || /^https:\/\/\S+$/.test(s);
  const icon = a => /^(\/uploads\/|https:\/\/)/.test(a.icon || "") ? `<img class="appicon" src="${esc(a.icon)}" alt="" width="72" height="72">` : `<span class="appemoji">${esc(a.icon || "📦")}</span>`;
  const sha = f => new Promise((ok, no) => { const h = crypto.createHash("sha256"); fs.createReadStream(f).on("data", d => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no); });
  const rm = f => { try { fs.unlinkSync(path.join(DL, f)); } catch {} };
  const CSS = '<style>.appicon{display:block;width:72px;height:72px;border-radius:1rem;object-fit:cover;margin-bottom:.4rem}.appemoji{display:block;font-size:3rem;line-height:1.1;margin-bottom:.2rem}details{margin:.3rem 0}summary{cursor:pointer}.meta code{font-size:.8rem}pre.notes{white-space:pre-wrap;font:inherit;margin:.4rem 0}.shots{display:flex;gap:.8rem;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:.5rem}.shots a{flex:0 0 auto;scroll-snap-align:start}.shots img{display:block;height:260px;width:auto;max-width:80vw;border-radius:1rem;border:2px solid #3b3463}</style>';

  /* ---------- public ---------- */
  const pub = express.Router();
  pub.get("/", (req, res) => res.set("Cache-Control", "public, max-age=60").send(page("Apps", `<img class="sec-img" src="/shared/img/apps.webp" alt="" width="140" height="140">${h1("Apps")}<p class="meta">Download apps made by VibePress. Every file shows a checksum so you can verify it.</p>
<ul class="grid">${all().map((a, i) => { const r = (a.releases || [])[0], pl = r ? [...new Set(r.files.map(PLAT))] : [];
    return `<li><a class="card" style="--c:${COLORS[i % 6]}" href="/apps/${esc(a.slug)}">${icon(a)}<h2>${esc(a.name)}</h2><p>${esc(a.tagline)}</p><p class="meta">${r ? "Version " + esc(r.version) + " | " + pl.join(", ") : "Coming soon"}${a.webUrl ? " | Web" : ""}</p></a></li>`; }).join("") || '<li class="note">No apps yet. Check back soon.</li>'}</ul>`,
    { index: true, head: UI + CSS + '<meta name="description" content="Download apps made by ' + esc(process.env.SITE_NAME || "VibePress") + '.">' })));
  pub.get("/:slug", (req, res) => {
    const a = all().find(x => x.slug === req.params.slug);
    if (!a) return res.status(404).send(page("Not found", "<p>That app was not found.</p>"));
    const rels = a.releases || [], row = (r, f) => `<div class="row"><a class="btn" style="--c:var(--green)" href="/get/${f.id}">${PICON(f)} Download ${esc(f.label)}</a><span class="meta">${PLAT(f)} | ${size(f.size)} | v${esc(r.version)}</span><details><summary class="meta">SHA-256 checksum</summary><code style="word-break:break-all">${esc(f.sha256)}</code></details></div>`;
    res.send(page(a.name, `${icon(a)}${h1(esc(a.name))}<p style="font-size:1.25rem">${esc(a.tagline)}</p><p>${esc(a.description).replace(/\n/g, "<br>")}</p>
${a.webUrl ? `<p><a class="btn" style="--c:var(--blue)" href="${esc(a.webUrl)}" target="_blank" rel="noopener">Open in your browser</a></p>` : ""}
${(a.screens || []).length ? `<h3 class="cat">Screenshots</h3><div class="shots">${a.screens.map(s => `<a href="/uploads/${esc(s.name)}" target="_blank" rel="noopener"><img src="/uploads/${esc(s.name)}" alt="${esc(s.alt || a.name + " screenshot")}" loading="lazy"></a>`).join("")}</div>` : ""}
${rels[0] ? `<h3 class="cat">Latest: version ${esc(rels[0].version)} <span class="meta">(${date(rels[0].date)})</span></h3>${rels[0].notes ? `<pre class="notes">${esc(rels[0].notes)}</pre>` : ""}<p class="meta">Available for: ${[...new Set(rels[0].files.map(f => PICON(f) + " " + PLAT(f)))].join(" &nbsp; ")}</p>${byPlat(rels[0]).map(f => row(rels[0], f)).join("")}
<p class="note">Android: open the downloaded file and allow installs from your browser when asked. Apps from outside an app store are only as safe as their source, so compare the checksum if you like.</p>`
      : '<p class="note">No downloads yet. Check back soon.</p>'}
${rels.length > 1 ? `<h3 class="cat">Older versions</h3>${rels.slice(1).map(r => `<details><summary>Version ${esc(r.version)} <span class="meta">(${date(r.date)})</span></summary>${r.notes ? `<pre class="notes">${esc(r.notes)}</pre>` : ""}${byPlat(r).map(f => row(r, f)).join("")}</details>`).join("")}` : ""}
<p><a href="/feedback/">Report a bug, share an idea, or apply to be a tester</a> &nbsp; <a href="/apps/">&larr; All apps</a></p>`,
      { index: true, head: UI + CSS + `<meta name="description" content="${esc(a.tagline || a.name)}"><meta property="og:title" content="${esc(a.name)}"><meta property="og:description" content="${esc(a.tagline)}">` + ld({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: a.name, description: a.description || a.tagline, applicationCategory: "Application", operatingSystem: rels[0] ? [...new Set(rels[0].files.map(PLAT))].join(", ") : undefined, url: SITE_URL + "/apps/" + a.slug, image: (a.screens || [])[0] ? SITE_URL + "/uploads/" + a.screens[0].name : undefined, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }) }));
  });
  const get = express.Router();
  get.get("/:id", (req, res) => {
    const list = all();
    for (const a of list) for (const r of a.releases || []) for (const f of r.files) if (f.id === req.params.id) {
      f.downloads = (f.downloads || 0) + 1; store.write(FILE, list);
      return res.set("Cache-Control", "no-store").redirect(302, "/downloads/" + encodeURIComponent(f.file));
    }
    res.status(404).send(page("Not found", "<p>That download was not found.</p>"));
  });

  /* ---------- admin ---------- */
  const admin = express.Router();
  const editor = (req, a, err) => page(a.oldSlug ? "Edit app" : "New app", `${h1(a.oldSlug ? "Edit app" : "New app")}${err ? `<p class="err">${esc(err)}</p>` : ""}
<form class="wide" method="post" action="/admin/apps/save">${hidden(req)}<input type="hidden" name="oldSlug" value="${esc(a.oldSlug || "")}">
<label>Name<input name="name" value="${esc(a.name || "")}" required maxlength="60"></label>
<label>Short address name (blank = from name)<input name="slug" value="${esc(a.slug || "")}" maxlength="50"></label>
<label>One-line tagline<input name="tagline" value="${esc(a.tagline || "")}" maxlength="120"></label>
<label>Description<textarea name="description" rows="6" maxlength="3000">${esc(a.description || "")}</textarea></label>
<label>Icon (an emoji, or an image address like /uploads/abc123.webp from the image library)<input name="icon" value="${esc(a.icon || "")}" maxlength="200"></label>
<label>Web version address (optional, https://...)<input name="webUrl" value="${esc(a.webUrl || "")}" maxlength="300"></label><button>Save</button></form>`, { head: UI });
  const manage = (req, a, err) => page("Manage " + a.name, `${h1(esc(a.name))}<p><a href="/admin/apps/">&larr; Apps</a> &nbsp; <a href="/admin/apps/edit/${esc(a.slug)}">Edit details</a> &nbsp; <a href="/apps/${esc(a.slug)}">View public page</a></p>${err ? `<p class="err">${esc(err)}</p>` : ""}
<form class="wide" method="post" action="/admin/apps/file" enctype="multipart/form-data">${hidden(req)}<input type="hidden" name="slug" value="${esc(a.slug)}">
<label>Version (e.g. 1.2.0). Reuse a version to add another file to it.<input name="version" required maxlength="30"></label>
<label>Platform<select name="platform">${ORDER.map(k => `<option value="${k}">${PLATS[k][1]} ${PLATS[k][0]}</option>`).join("")}</select></label>
<label>Button label (optional, e.g. Android APK; blank = platform name)<input name="label" maxlength="60"></label>
<label>What changed (used when this creates a new version)<textarea name="notes" rows="3" maxlength="2000"></textarea></label>
<label>File (apk, aab, exe, msi, dmg, pkg, deb, rpm, appimage, tgz, tar.gz, ipa, zip or 7z, up to ${MAXMB} MB)<input type="file" name="file" required></label><button>Upload release file</button></form>
<h3 class="cat">Screenshots (${(a.screens || []).length} of 8)</h3>
<form class="wide" method="post" action="/admin/apps/shot" enctype="multipart/form-data">${hidden(req)}<input type="hidden" name="slug" value="${esc(a.slug)}">
<label>Screenshot (JPG, PNG, WebP or GIF, up to 10 MB)<input type="file" name="shot" accept="image/jpeg,image/png,image/webp,image/gif" required></label>
<label>Short description (for accessibility)<input name="alt" maxlength="150"></label><button>Add screenshot</button></form>
${(a.screens || []).map((s, i) => `<div class="row"><img src="/uploads/${esc(s.name)}" alt="" width="90" height="60" style="object-fit:cover;border-radius:.6rem"><span class="meta">${esc(s.alt || "(no description)")}</span>${i ? `<form class="inline" method="post" action="/admin/apps/shot-first">${hidden(req)}<input type="hidden" name="slug" value="${esc(a.slug)}"><input type="hidden" name="name" value="${esc(s.name)}"><button>Move to first</button></form>` : ""}<form class="inline" method="post" action="/admin/apps/shot-delete">${hidden(req)}<input type="hidden" name="slug" value="${esc(a.slug)}"><input type="hidden" name="name" value="${esc(s.name)}"><button class="danger">Delete</button></form></div>`).join("")}
${(a.releases || []).map(r => `<h3 class="cat">Version ${esc(r.version)} <span class="meta">${date(r.date)}</span></h3>${r.files.map(f => `<div class="row"><strong>${esc(f.label)}</strong><span class="meta">${PLAT(f)} | ${esc(f.file)} | ${size(f.size)} | ${f.downloads || 0} downloads</span><form class="inline" method="post" action="/admin/apps/file-delete">${hidden(req)}<input type="hidden" name="slug" value="${esc(a.slug)}"><input type="hidden" name="id" value="${f.id}"><button class="danger">Delete</button></form></div>`).join("")}`).join("") || '<p class="note">No release files yet.</p>'}`, { head: UI });

  admin.get("/", (req, res) => res.send(page("Apps admin", `${h1("Apps")}<p><a class="btn" style="--c:var(--red)" href="/admin/apps/new">New app</a> <a href="/admin/">&larr; Dashboard</a></p>${all().map(a => `<div class="row"><strong>${esc(a.name)}</strong><span class="meta">${(a.releases || []).length} versions</span><a href="/admin/apps/manage/${esc(a.slug)}">Releases</a><a href="/admin/apps/edit/${esc(a.slug)}">Edit</a><a href="/admin/apps/delete/${esc(a.slug)}">Delete</a></div>`).join("") || '<p class="note">No apps yet.</p>'}`, { head: UI })));
  admin.get("/new", (req, res) => res.send(editor(req, {})));
  admin.get("/edit/:s", (req, res) => { const a = all().find(x => x.slug === req.params.s); a ? res.send(editor(req, { ...a, oldSlug: a.slug })) : res.redirect("/admin/apps/"); });
  admin.get("/manage/:s", (req, res) => { const a = all().find(x => x.slug === req.params.s); a ? res.send(manage(req, a)) : res.redirect("/admin/apps/"); });
  admin.get("/delete/:s", (req, res) => { const a = all().find(x => x.slug === req.params.s); if (!a) return res.redirect("/admin/apps/");
    res.send(page("Delete app", `${h1("Delete this app?")}<p>${esc(a.name)} and all its uploaded files will be removed.</p><form method="post" action="/admin/apps/delete">${hidden(req)}<input type="hidden" name="slug" value="${esc(a.slug)}"><button class="danger">Yes, delete it</button></form><p><a href="/admin/apps/">Cancel</a></p>`, { head: UI })); });
  admin.post("/delete", verifyCsrf, (req, res) => {
    const list = all(), a = list.find(x => x.slug === String(req.body.slug || ""));
    if (a) { (a.releases || []).forEach(r => r.files.forEach(f => rm(f.file))); (a.screens || []).forEach(s => imgutil.remove(s.name)); store.write(FILE, list.filter(x => x !== a)); }
    res.redirect("/admin/apps/");
  });
  admin.post("/save", verifyCsrf, (req, res) => {
    const b = req.body, list = all(), oldSlug = String(b.oldSlug || ""), old = list.find(x => x.slug === oldSlug);
    const a = { name: clip(b.name, 60), tagline: clip(b.tagline, 120), description: clip(b.description, 3000), icon: clip(b.icon, 200), webUrl: clip(b.webUrl, 300), releases: old ? old.releases || [] : [] };
    a.slug = slugify(b.slug || a.name) || "app-" + Date.now();
    const show = m => res.status(400).send(editor(req, { ...a, oldSlug }, m));
    if (!a.name) return show("A name is required.");
    if (!iconOk(a.icon)) return show("The icon must be an emoji, a /uploads/ image, or an https image address.");
    if (a.webUrl && !/^https?:\/\/\S+$/.test(a.webUrl)) return show("The web address must start with http:// or https://");
    if (a.slug !== oldSlug && list.some(x => x.slug === a.slug)) return show("That short address name is already used.");
    store.write(FILE, old ? list.map(x => x.slug === oldSlug ? a : x) : list.concat(a));
    res.redirect("/admin/apps/manage/" + a.slug);
  });
  admin.post("/file", (req, res, next) => up.single("file")(req, res, err => err ? res.status(400).send(page("Upload failed", `${h1("Upload failed")}<p class="err">${err.code === "LIMIT_FILE_SIZE" ? "That file is over " + MAXMB + " MB." : "The upload did not finish."}</p><p><a href="javascript:history.back()">Go back</a></p>`)) : next()),
    verifyCsrf, async (req, res) => {
      const f = req.file, list = all(), a = list.find(x => x.slug === String(req.body.slug || ""));
      if (!a) { if (f) rm(f.filename); return res.redirect("/admin/apps/"); }
      const version = clip(req.body.version, 30), platform = String(req.body.platform || "");
      if (f && !PLATS[platform]) { rm(f.filename); return res.status(400).send(manage(req, a, "Please choose a platform.")); }
      if (f && !PLATS[platform][2].includes(extOf(f.originalname))) { rm(f.filename); return res.status(400).send(manage(req, a, "A ." + extOf(f.originalname) + " file does not match " + PLATS[platform][0] + ". Pick the right platform or file.")); }
      if (!f) return res.status(400).send(manage(req, a, "Choose a file of an allowed type."));
      if (!/^[\w.+-]+$/.test(version)) { rm(f.filename); return res.status(400).send(manage(req, a, "Use only letters, numbers, dots, dashes and plus signs in the version.")); }
      const hash = await sha(f.path);
      a.releases = a.releases || [];
      let r = a.releases.find(x => x.version === version);
      if (!r) { r = { version, notes: clip(req.body.notes, 2000), date: new Date().toISOString(), files: [] }; a.releases.unshift(r); }
      r.files.push({ id: crypto.randomBytes(6).toString("hex"), label: clip(req.body.label, 60) || PLATS[platform][0], platform, file: f.filename, size: f.size, sha256: hash, downloads: 0 });
      store.write(FILE, list); res.redirect("/admin/apps/manage/" + a.slug);
    });
  admin.post("/file-delete", verifyCsrf, (req, res) => {
    const list = all(), a = list.find(x => x.slug === String(req.body.slug || ""));
    if (a) { a.releases.forEach(r => { const f = r.files.find(x => x.id === req.body.id); if (f) { rm(f.file); r.files = r.files.filter(x => x !== f); } }); a.releases = a.releases.filter(r => r.files.length); store.write(FILE, list); }
    res.redirect("/admin/apps/" + (a ? "manage/" + a.slug : ""));
  });
  admin.post("/shot", (req, res, next) => upImg.single("shot")(req, res, err => err ? res.status(400).send(page("Upload failed", `${h1("Upload failed")}<p class="err">${err.code === "LIMIT_FILE_SIZE" ? "That image is over 10 MB." : "The upload did not finish."}</p><p><a href="/admin/apps/">Back to apps</a></p>`)) : next()),
    verifyCsrf, async (req, res) => {
      const list = all(), a = list.find(x => x.slug === String(req.body.slug || ""));
      if (!a) return res.redirect("/admin/apps/");
      a.screens = a.screens || [];
      if (a.screens.length >= 8) return res.status(400).send(manage(req, a, "Up to 8 screenshots per app. Delete one first."));
      const name = await imgutil.save(req.file && req.file.buffer);
      if (!name) return res.status(400).send(manage(req, a, "Please choose a JPG, PNG, WebP or GIF image."));
      a.screens.push({ name, alt: clip(req.body.alt, 150) }); store.write(FILE, list);
      res.redirect("/admin/apps/manage/" + a.slug);
    });
  admin.post("/shot-delete", verifyCsrf, (req, res) => {
    const list = all(), a = list.find(x => x.slug === String(req.body.slug || ""));
    if (a && a.screens) { const s = a.screens.find(x => x.name === req.body.name); if (s) { imgutil.remove(s.name); a.screens = a.screens.filter(x => x !== s); store.write(FILE, list); } }
    res.redirect("/admin/apps/" + (a ? "manage/" + a.slug : ""));
  });
  admin.post("/shot-first", verifyCsrf, (req, res) => {
    const list = all(), a = list.find(x => x.slug === String(req.body.slug || ""));
    if (a && a.screens) { const s = a.screens.find(x => x.name === req.body.name); if (s) { a.screens = [s].concat(a.screens.filter(x => x !== s)); store.write(FILE, list); } }
    res.redirect("/admin/apps/" + (a ? "manage/" + a.slug : ""));
  });
  return { pub, get, admin };
};
