/* Safe opening of a .vpplugin package (a zip): size limits, allowed file types, no path tricks, no links, manifest check, scan, fingerprint. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execFileSync } = require("child_process");
const { validate } = require("./manifest"), { scan } = require("./scan");
const LIMITS = { zip: 5 * 1048576, files: 120, total: 3 * 1048576, one: 1048576 };
const PUBLIC_EXT = /\.(html|css|js|json|txt|md|svg|png|jpe?g|gif|webp|ico|woff2)$/i, CODE_EXT = /\.(js|json|md|txt)$/i;

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const p = path.join(dir, d.name), st = fs.lstatSync(p);
  if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error(`"${path.relative(base, p)}" is a link or special file, which plugins may not contain.`);
  return st.isDirectory() ? walk(p, base) : [{ rel: path.relative(base, p).split(path.sep).join("/"), size: st.size, abs: p }];
});

/* Checks an unpacked plugin folder. Used for uploads and by the author's check command. */
function inspectDir(base, version) {
  const errors = [], findings = [];
  let files; try { files = walk(base); } catch (e) { return { ok: false, errors: [e.message], findings, files: [] }; }
  if (files.length > LIMITS.files) errors.push(`Too many files (limit ${LIMITS.files}).`);
  if (files.reduce((n, f) => n + f.size, 0) > LIMITS.total) errors.push(`The plugin is larger than ${LIMITS.total / 1048576} MB unpacked.`);
  for (const f of files) {
    if (f.size > LIMITS.one) errors.push(`"${f.rel}" is larger than 1 MB.`);
    if (/\.DS_Store$|^__MACOSX\//.test(f.rel)) continue;
    const pub = f.rel.startsWith("public/");
    if (pub ? !PUBLIC_EXT.test(f.rel) : !CODE_EXT.test(f.rel)) errors.push(`"${f.rel}" is not an allowed file type${pub ? "" : " (only .js, .json, .md and .txt are allowed outside the public folder)"}.`);
  }
  const mf = files.find(f => f.rel === "plugin.json");
  if (!mf) return { ok: false, errors: [...errors, "There is no plugin.json at the top of the package."], findings, files };
  let raw; try { raw = JSON.parse(fs.readFileSync(mf.abs, "utf8")); } catch { return { ok: false, errors: [...errors, "plugin.json is not valid JSON."], findings, files }; }
  const v = validate(raw, version); errors.push(...v.errors);
  const m = v.manifest, has = r => files.some(f => f.rel === r);
  for (const p of m.pages) if (!has("public/" + p.path)) errors.push(`Page "${p.title}" points to public/${p.path}, which is not in the package.`);
  if (m.server && !has(m.server)) errors.push(`"server" points to ${m.server}, which is not in the package.`);
  for (const f of files) {
    if (!/\.(js|html|svg)$/i.test(f.rel) || f.size > LIMITS.one) continue;
    const isServer = /\.js$/i.test(f.rel) && !f.rel.startsWith("public/");
    findings.push(...scan(f.rel, fs.readFileSync(f.abs, "utf8"), isServer));
  }
  return { ok: !errors.length && !findings.some(f => f.level === "block"), errors, findings, files: files.map(({ rel, size }) => ({ rel, size })), manifest: m };
}

/* Opens a zip into dest (created here). Returns the same shape as inspectDir plus hash and base. */
function inspect(zipPath, dest, version) {
  const bad = (...errors) => ({ ok: false, errors, findings: [], files: [] });
  const buf = fs.readFileSync(zipPath);
  if (buf.length > LIMITS.zip) return bad(`The file is larger than ${LIMITS.zip / 1048576} MB.`);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  let names, info;
  try { names = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", timeout: 15000, maxBuffer: 1 << 20, stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); info = execFileSync("unzip", ["-Zt", zipPath], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return { ...bad("This is not a valid zip file (or the unzip tool is missing on the server)."), hash }; }
  if (names.length > LIMITS.files + 20) return { ...bad(`Too many files (limit ${LIMITS.files}).`), hash };
  const total = parseInt((info.match(/(\d+) bytes uncompressed/) || [])[1] || "0", 10);
  if (total > LIMITS.total + 65536) return { ...bad(`The plugin is larger than ${LIMITS.total / 1048576} MB unpacked.`), hash };
  for (const n of names) if (n.startsWith("/") || n.includes("\\") || n.split("/").includes("..") || n.includes("\0")) return { ...bad(`The package contains an unsafe file path ("${n.slice(0, 60)}").`), hash };
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  try { execFileSync("unzip", ["-qq", "-o", zipPath, "-x", "__MACOSX/*", "*.DS_Store", "-d", dest], { timeout: 20000, stdio: "ignore" }); }
  catch { return { ...bad("The zip could not be unpacked."), hash }; }
  let base = dest;                                       // allow one wrapping folder, as most zip tools create
  if (!fs.existsSync(path.join(dest, "plugin.json"))) { const sub = fs.readdirSync(dest).filter(n => fs.statSync(path.join(dest, n)).isDirectory()); if (sub.length === 1 && fs.existsSync(path.join(dest, sub[0], "plugin.json"))) base = path.join(dest, sub[0]); }
  return { ...inspectDir(base, version), hash, base };
}
module.exports = { inspect, inspectDir, LIMITS };
