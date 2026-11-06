/* Shared image saving: checks the real file type, resizes and strips metadata when sharp is installed, saves to UPLOAD_DIR (served at /uploads/). */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
let sharp = null; try { sharp = require("sharp"); } catch { /* optional */ }
const DIR = process.env.UPLOAD_DIR || "/var/www/vibepress/site/uploads";
fs.mkdirSync(DIR, { recursive: true });
const kind = b => {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpg";
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return "png";
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "webp";
  if (b.slice(0, 4).toString() === "GIF8") return "gif";
  return null;
};
exports.save = async buf => {
  const k = kind(buf); if (!k) return null;
  let out = buf, ext = k;
  if (sharp && k !== "gif") { try { out = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); ext = "webp"; } catch { return null; } }
  const name = crypto.randomBytes(8).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(DIR, name), out, { mode: 0o644 });
  return name;
};
exports.remove = n => { if (/^[0-9a-f]{16}\.(jpg|png|webp|gif)$/.test(String(n))) try { fs.unlinkSync(path.join(DIR, n)); } catch {} };
