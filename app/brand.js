/* The site name and section titles, read live from brand.json (so a rename in Admin > Site name shows everywhere at once, no restart).
   Falls back to the SITE_NAME that install.sh recorded, then to "VibePress". */
const fs = require("fs");
const file = () => process.env.BRAND_FILE || "/var/www/vibepress/brand.json";
let cache = { sig: "", data: {} };
const read = () => {
  try { const st = fs.statSync(file()), sig = st.mtimeMs + ":" + st.size; if (sig !== cache.sig) cache = { sig, data: JSON.parse(fs.readFileSync(file(), "utf8")) }; }
  catch { cache = { sig: "", data: {} }; }
  return cache.data || {};
};
const clean = s => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
Object.defineProperty(exports, "name", { enumerable: true, get: () => clean(read().name) || clean(process.env.SITE_NAME) || "VibePress" });
Object.defineProperty(exports, "tagline", { enumerable: true, get: () => clean(read().tagline) });
exports.homeTitle = () => clean((read().home || {}).title);
exports.section = (k, d) => ((read().sections || {})[k] || {}).title || d;
exports.clean = clean;
