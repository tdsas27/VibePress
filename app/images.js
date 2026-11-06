/* Blog image library: upload at /admin/images/, files saved to UPLOAD_DIR (served by Nginx at /uploads/). */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), express = require("express"), multer = require("multer");
let sharp = null; try { sharp = require("sharp"); } catch { /* optional: without it, images are saved as uploaded */ }
const store = require("./store"), UI = require("./ui");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const DIR = process.env.UPLOAD_DIR || "/var/www/vibepress/site/uploads";
  fs.mkdirSync(DIR, { recursive: true });
  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  const all = () => store.read("uploads.json");
  const kind = b => {                                            // check the real file contents, not the name
    if (b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpg";
    if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return "png";
    if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "webp";
    if (b.slice(0, 4).toString() === "GIF8") return "gif";
    return null;
  };
  const admin = express.Router();
  const library = (req, msg) => page("Images", `${h1("Images")}<p><a href="/admin/blog/">&larr; Blog</a></p>${msg ? `<p class="err">${esc(msg)}</p>` : ""}
<form class="wide" method="post" action="/admin/images/upload" enctype="multipart/form-data">${hidden(req)}
<label>Image (JPG, PNG, WebP or GIF, up to 8 MB)<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required></label>
<label>Description (alt text, for accessibility and search)<input name="alt" maxlength="150"></label><button>Upload</button></form>
<p class="meta">Click a line below to copy it, then paste it into your post.</p>
${all().map(i => { const snip = `![${i.alt.replace(/[\[\]\n]/g, " ")}](/uploads/${i.name})`; return `<div class="row"><img src="/uploads/${esc(i.name)}" alt="" width="80" height="80" style="object-fit:cover;border-radius:.6rem"><input class="snip" readonly value="${esc(snip)}" size="38"><form class="inline" method="post" action="/admin/images/delete">${hidden(req)}<input type="hidden" name="name" value="${esc(i.name)}"><button class="danger">Delete</button></form></div>`; }).join("") || '<p class="note">No images yet.</p>'}
<script src="/shared/admin-copy.js"></script>`, { head: UI });

  admin.get("/", (req, res) => res.send(library(req)));
  admin.post("/upload", (req, res, next) => up.single("image")(req, res, err => err ? res.status(400).send(library(req, err.code === "LIMIT_FILE_SIZE" ? "That image is over 8 MB." : "Upload failed.")) : next()),
    verifyCsrf, async (req, res) => {
      const f = req.file, k = f && kind(f.buffer);
      if (!k) return res.status(400).send(library(req, "Please choose a JPG, PNG, WebP or GIF image."));
      let buf = f.buffer, ext = k;
      if (sharp && k !== "gif") {                                // resize and strip hidden metadata (like GPS) when sharp is installed
        try { buf = await sharp(f.buffer).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); ext = "webp"; }
        catch { return res.status(400).send(library(req, "That image could not be read.")); }
      }
      const name = crypto.randomBytes(8).toString("hex") + "." + ext;
      fs.writeFileSync(path.join(DIR, name), buf, { mode: 0o644 });
      if (sharp && ext !== "gif") { try { await sharp(f.buffer).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 75 }).toFile(path.join(DIR, name.replace(/\.\w+$/, "") + "-t.webp")); } catch {} }   // small version for teasers
      store.write("uploads.json", [{ name, alt: String(req.body.alt || "").slice(0, 150), created: new Date().toISOString(), size: buf.length }].concat(all()));
      res.redirect("/admin/images/");
    });
  admin.post("/delete", verifyCsrf, (req, res) => {
    const n = String(req.body.name || "");
    if (/^[0-9a-f]{16}\.(jpg|png|webp|gif)$/.test(n)) { try { fs.unlinkSync(path.join(DIR, n)); } catch {} try { fs.unlinkSync(path.join(DIR, n.replace(/\.\w+$/, "") + "-t.webp")); } catch {} store.write("uploads.json", all().filter(i => i.name !== n)); }
    res.redirect("/admin/images/");
  });
  return { admin };
};
