/* Where plugin files live (resolved when used, so tests and the installer can point elsewhere). */
const path = require("path");
exports.data = () => process.env.VP_DATA_DIR || path.join(__dirname, "..", "data");
exports.site = () => process.env.SITE_DIR || "/var/www/vibepress/site";
exports.root = () => path.join(exports.data(), "plugins");               // plugins/<id>/{code,package.vpplugin}
exports.store = () => path.join(exports.data(), "plugin-data");          // plugin-data/<id>.json  (each plugin's own data)
exports.staging = () => path.join(exports.data(), "plugin-staging");     // uploads waiting for review
exports.served = id => path.join(exports.site(), "x", id);               // static files served by Nginx at /x/<id>/
exports.files = () => path.join(exports.data(), "plugin-files");              // private files: never inside the web folder
