/* Reads brand.json (site name and section titles) so the app and the static pages agree. */
const fs = require("fs");
let B = {}; try { B = JSON.parse(fs.readFileSync(process.env.BRAND_FILE || "/var/www/vibepress/brand.json", "utf8")); } catch { /* defaults */ }
exports.name = process.env.SITE_NAME || B.name || "VibePress";
exports.section = (k, d) => ((B.sections || {})[k] || {}).title || d;
