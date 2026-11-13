/* Tiny JSON file store: data/<name>.json (written atomically, owner-only). */
const fs = require("fs"), path = require("path");
const DIR = process.env.VP_DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
exports.read = (name, fallback = []) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")); } catch { return fallback; } };
exports.write = (name, data) => { const f = path.join(DIR, name), t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(t, f); };
