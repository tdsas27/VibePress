/* Safe read / write of brand.json for the admin pages (Menu, Theme), plus rebuilding the static site from it.
   Every write keeps the previous copy as brand.json.prev so a change can be undone. */
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const FILE = () => process.env.BRAND_FILE || "/var/www/vibepress/brand.json";

exports.read = () => { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { return {}; } };
exports.write = obj => {
  const f = FILE(), t = f + ".tmp";
  try { fs.copyFileSync(f, f + ".prev"); } catch { /* first write */ }
  fs.writeFileSync(t, JSON.stringify(obj, null, 2), { mode: 0o644 });
  fs.renameSync(t, f);
};
exports.hasPrev = () => fs.existsSync(FILE() + ".prev");
exports.undo = () => {                       // swaps current and previous, so Undo can be undone too
  const f = FILE(), p = f + ".prev", t = f + ".swap";
  if (!fs.existsSync(p)) return false;
  fs.copyFileSync(f, t); fs.copyFileSync(p, f); fs.renameSync(t, p); return true;
};
exports.render = () => new Promise(resolve => {      // runs render-site.js; resolves { ok, message }
  execFile(process.execPath, [path.join(__dirname, "render-site.js")], { env: process.env, timeout: 30000 }, (err, out, errOut) =>
    resolve(err ? { ok: false, message: String(errOut || err.message).trim().slice(0, 400) } : { ok: true, message: "" }));
});
