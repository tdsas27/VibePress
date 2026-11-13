/* Private files for plugins that sell or protect downloads. The bytes live in data/plugin-files/<plugin>/, outside the web folder; plugin code
   never sees the bytes or the paths. It can only ask for a short-lived link (pdata.grants) that the app then serves. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), P = require("./paths"), pdata = require("./pdata");
const FID = /^[a-f0-9]{12}$/;
const maxFile = () => (parseInt(process.env.PLUGIN_FILE_MAX_MB, 10) || 500) * 1048576;
const maxTotal = () => (parseInt(process.env.PLUGIN_FILES_TOTAL_MB, 10) || 4096) * 1048576;
exports.maxFileMB = () => maxFile() / 1048576;
exports.FID = FID;
exports.dir = id => path.join(P.files(), id);
exports.pathOf = (id, fid) => { if (!FID.test(String(fid)) || !pdata.files.get(id, fid)) return null; return path.join(exports.dir(id), fid); };
const cleanName = n => { const b = path.basename(String(n || "file").replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"<>:|?*\\/]/g, "_").trim().slice(-100); return b && b !== "." && b !== ".." ? b : "file"; };

/* Moves an uploaded temp file in and records it. Throws a readable error if it does not fit. */
exports.add = async (id, tmpPath, originalName) => {
  const size = fs.statSync(tmpPath).size;
  if (size < 1) throw new Error("That file is empty.");
  if (size > maxFile()) throw new Error(`Files can be up to ${exports.maxFileMB()} MB.`);
  if (pdata.files.list(id).reduce((n, r) => n + r.size, 0) + size > maxTotal()) throw new Error("This plugin's private file storage is full.");
  const hash = crypto.createHash("sha256");
  await new Promise((ok, no) => fs.createReadStream(tmpPath).on("data", c => hash.update(c)).on("end", ok).on("error", no));
  const fid = crypto.randomBytes(6).toString("hex"), dir = exports.dir(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.renameSync(tmpPath, path.join(dir, fid)); } catch { fs.copyFileSync(tmpPath, path.join(dir, fid)); fs.rmSync(tmpPath, { force: true }); }
  fs.chmodSync(path.join(dir, fid), 0o600);
  const rec = { name: cleanName(originalName), size, sha256: hash.digest("hex"), at: new Date().toISOString() };
  pdata.files.add(id, fid, rec); return Object.assign({ id: fid }, rec);
};
exports.remove = (id, fid) => { if (!FID.test(String(fid))) return; fs.rmSync(path.join(exports.dir(id), fid), { force: true }); pdata.files.del(id, fid); };
