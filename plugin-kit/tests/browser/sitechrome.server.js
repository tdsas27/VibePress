// Static test server for the shared header/footer (tds.js). It mimics what Nginx does on a real VibePress server:
//   - plugin pages under /x/ get the REAL sandbox CSP header (read from nginx/plugins.conf.template)
//   - a folder with no index.html answers 403 "Forbidden" (this is the "access denied" a visitor saw on /x/)
//   - /site.json carries the CORS header a sandboxed page needs
// The site is built by the real render-site.js from config/brand.example.json, plus a hand-made site.json (as Admin > Site writes it).
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..", ".."), APP = path.join(ROOT, "app"), KIT = path.join(ROOT, "plugin-kit");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vp-chrome-")), SITE = tmp + "/site", port = parseInt(process.env.PORT, 10) || 8299;
const tpl = fs.readFileSync(path.join(ROOT, "nginx", "plugins.conf.template"), "utf8"), CSP = /add_header Content-Security-Policy "([^"]+)"/.exec(tpl)[1];
fs.mkdirSync(SITE, { recursive: true });
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "brand.example.json"), "utf8")); brand.name = process.env.TEST_NAME || "Test Site"; brand.domain = "localhost";
fs.writeFileSync(tmp + "/brand.json", JSON.stringify(brand));
execFileSync(process.execPath, [path.join(APP, "render-site.js")], { env: Object.assign({}, process.env, { BRAND_FILE: tmp + "/brand.json", SITE_DIR: SITE, TEMPLATES_DIR: path.join(ROOT, "templates"), SITE_URL: "http://localhost:" + port }), stdio: "ignore" });
for (const f of ["404.html"]) fs.copyFileSync(path.join(ROOT, "templates", "static", f), path.join(SITE, f));
fs.mkdirSync(SITE + "/x/hello-world", { recursive: true });                      // a plugin page, exactly as the platform stores it
fs.copyFileSync(path.join(KIT, "examples", "hello-world", "public", "index.html"), SITE + "/x/hello-world/index.html");
fs.copyFileSync(path.join(KIT, "examples", "hello-world", "public", "hello.js"), SITE + "/x/hello-world/hello.js");
fs.mkdirSync(SITE + "/games", { recursive: true });
fs.writeFileSync(SITE + "/games/index.html", fs.readFileSync(SITE + "/index.html", "utf8").replace(" data-home", ""));   // stands in for a section page
// what Admin > Site publishes: a custom copyright line, which used to replace the whole line, "Powered by" link included
fs.writeFileSync(SITE + "/site.json", JSON.stringify({ name: brand.name, copyright: "\u00a9 {year} " + brand.name + ". All rights reserved.", tagline: "", social: [], legal: [] }));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); let file = path.join(SITE, decodeURIComponent(u.pathname));
  if (!file.startsWith(SITE)) { res.statusCode = 400; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { const ix = path.join(file, "index.html"); if (!u.pathname.endsWith("/")) { res.statusCode = 301; res.setHeader("Location", u.pathname + "/"); return res.end(); } if (!fs.existsSync(ix)) { res.statusCode = 403; return res.end("403 Forbidden"); } file = ix; }
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("404 not found"); }
  if (u.pathname.startsWith("/x/")) res.setHeader("Content-Security-Policy", CSP);
  if (u.pathname === "/site.json") res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream"); res.end(fs.readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log("READY " + port));
process.on("SIGTERM", () => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); });
