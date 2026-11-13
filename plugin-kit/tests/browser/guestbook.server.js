// Minimal real HTTP server for browser-based plugin tests: serves plugin pages with the REAL sandbox CSP header (read straight from
// nginx/plugins.conf.template, so a template change is tested automatically) and routes /x-api/ to the real plugin engine.
const http = require("http"), fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..", ".."), KIT = path.join(ROOT, "plugin-kit"), APP = path.join(ROOT, "app");
const { load } = require(path.join(KIT, "tests", "harness"));
const H = load(), { tmp, registry } = H;
const tpl = fs.readFileSync(path.join(ROOT, "nginx", "plugins.conf.template"), "utf8"), CSP = /add_header Content-Security-Policy "([^"]+)"/.exec(tpl)[1];
fs.mkdirSync(tmp + "/site", { recursive: true }); fs.copyFileSync(path.join(ROOT, "config", "brand.example.json"), tmp + "/brand.json");
execFileSync(process.execPath, [path.join(APP, "render-site.js")], { env: Object.assign({}, process.env, { BRAND_FILE: tmp + "/brand.json", SITE_DIR: tmp + "/site", TEMPLATES_DIR: path.join(ROOT, "templates"), SITE_URL: "http://localhost:" + (process.env.PORT || 8199) }), stdio: "ignore" });
const m = H.pkg.inspectDir(path.join(KIT, "examples", "guestbook"), "0.3.0");
registry.install({ base: path.join(KIT, "examples", "guestbook"), manifest: m.manifest, hash: "t", zipPath: path.join(KIT, "examples", "guestbook", "plugin.json"), granted: m.manifest.permissions });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/x-api/")) {
    const chunks = []; for await (const c of req) chunks.push(c); let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
    const out = await H.call(H.mod.pub, req.method, u.pathname.slice("/x-api".length), { body, query: Object.fromEntries(u.searchParams), headers: { "x-real-ip": "9.9.9.1" } });
    for (const [k, v] of Object.entries(out.hdr)) res.setHeader(k, v);
    res.statusCode = out.code; res.end(out.body); return;
  }
  let file = path.join(tmp, "site", u.pathname); if (u.pathname.endsWith("/")) file = path.join(file, "index.html");
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    if (u.pathname.startsWith("/x/")) res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream"); res.end(fs.readFileSync(file)); return;
  }
  res.statusCode = 404; res.end("nf");
});
const port = parseInt(process.env.PORT, 10) || 8199;
server.listen(port, "127.0.0.1", () => console.log("READY " + port));
process.on("SIGTERM", () => { H.host.stopAll(); server.close(); process.exit(0); });
