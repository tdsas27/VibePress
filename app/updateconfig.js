/* Tiny settings file for Admin > Updates: which GitHub repo to check, and when we last checked. Separate from brand.json because it
   is server configuration, not site branding. */
const fs = require("fs"), path = require("path");
const FILE = () => path.join(process.env.VP_DATA_DIR || path.join(__dirname, "data"), "update-config.json");
exports.read = () => { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { return {}; } };
exports.write = obj => { const f = FILE(), t = f + ".tmp"; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(t, JSON.stringify(obj, null, 2), { mode: 0o600 }); fs.renameSync(t, f); };
