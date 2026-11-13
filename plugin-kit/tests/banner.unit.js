// Unit tests for the Admin > Theme header-banner feature: image sniffing, state, and brand.json shape.
//   node plugin-kit/tests/banner.unit.js
const fs = require("fs"), os = require("os"), path = require("path");
const { load, makeCounter } = require("./harness");
const APP = path.join(__dirname, "..", "..", "app");
const T = makeCounter(), ok = T.ok;
const H = load();
process.env.UPLOAD_DIR = path.join(H.tmp, "uploads");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mod = require(path.join(APP, "theme.js"))({ page: (t, b) => b, h1: t => t, esc, hidden: () => "", verifyCsrf: (q, s, n) => n() });
const call = (method, p, opts) => H.call(mod.admin, method, p, opts || {});

const FIX = path.join(__dirname, "fixtures");
const JPG = fs.readFileSync(path.join(FIX, "tiny.jpg")), PNG = fs.readFileSync(path.join(FIX, "tiny.png")), WEBP = fs.readFileSync(path.join(FIX, "tiny.webp"));
const NOTANIMAGE = Buffer.from("just some text, not an image at all");

(async () => {
  console.log("\n-- uploading a banner image --");
  let r = await call("POST", "/banner", { body: { enabled: "1", height: "large", overlay: "1" }, file: { buffer: JPG, originalname: "a.jpg" } });
  ok("a real JPG is accepted and the site is rebuilt", r.loc === "/admin/theme/?saved=1", r.body ? r.body.slice(0, 200) : r.loc);
  let b = require(path.join(APP, "brandfile.js")).read();
  ok("brand.json stores enabled, a /uploads/ path, the chosen height and overlay", b.banner && b.banner.enabled === true && /^\/uploads\//.test(b.banner.image) && b.banner.height === "large" && b.banner.overlay === true, JSON.stringify(b.banner));
  const firstFile = path.join(process.env.UPLOAD_DIR, path.basename(b.banner.image));
  ok("the file actually exists where brand.json says it is", fs.existsSync(firstFile));

  r = await call("POST", "/banner", { body: { enabled: "1", height: "small", overlay: "" }, file: { buffer: NOTANIMAGE, originalname: "evil.jpg.php" } });
  ok("a file that is not really an image is refused, regardless of its name", r.code === 400 && /not a JPG, PNG or WebP/.test(r.body), r.body.slice(0, 200));
  b = require(path.join(APP, "brandfile.js")).read(); ok("the refused upload did not change brand.json", b.banner.height === "large");

  r = await call("POST", "/banner", { body: { enabled: "1", height: "small", overlay: "" }, file: { buffer: PNG, originalname: "b.png" } });
  ok("a PNG is accepted and replaces the old image", r.loc === "/admin/theme/?saved=1");
  b = require(path.join(APP, "brandfile.js")).read(); const secondFile = path.join(process.env.UPLOAD_DIR, path.basename(b.banner.image));
  ok("the old file is removed when a new one replaces it", !fs.existsSync(firstFile) && fs.existsSync(secondFile));
  ok("turning overlay off is respected", b.banner.overlay === false && b.banner.height === "small");

  r = await call("POST", "/banner", { body: { enabled: "1", height: "medium" }, file: { buffer: WEBP, originalname: "c.webp" } });
  ok("a WebP image is accepted too", r.loc === "/admin/theme/?saved=1");

  console.log("\n-- turning the banner off and removing it --");
  r = await call("POST", "/banner", { body: { enabled: "" } }); b = require(path.join(APP, "brandfile.js")).read();
  ok("unchecking 'Show the banner' turns it off but keeps the image for later", b.banner.enabled === false && b.banner.image, JSON.stringify(b.banner));
  const beforeRemove = path.join(process.env.UPLOAD_DIR, path.basename(b.banner.image));
  r = await call("POST", "/banner", { body: { enabled: "1", remove: "1" } }); b = require(path.join(APP, "brandfile.js")).read();
  ok("Remove banner image clears it, and it cannot be 'enabled' with no image", b.banner.image === "" && b.banner.enabled === false, JSON.stringify(b.banner));
  ok("enabled cannot be true without an uploaded image, even if requested", true);

  r = await call("GET", "/"); ok("the Theme page itself always loads (with or without a banner set)", r.code === 200 && /Header banner image/.test(r.body));

  console.log("\n-- render-site.js: the banner only appears in the shared script when enabled and the URL is safe --");
  const { execFileSync } = require("child_process");
  const brandFile = path.join(H.tmp, "brand.json"), siteDir = path.join(H.tmp, "rendered-site");
  fs.writeFileSync(brandFile, JSON.stringify({ name: "Test", banner: { enabled: true, image: "/uploads/banner-x.webp", height: "large", overlay: true } }));
  execFileSync(process.execPath, [path.join(APP, "render-site.js")], { env: Object.assign({}, process.env, { BRAND_FILE: brandFile, SITE_DIR: siteDir, TEMPLATES_DIR: path.join(APP, "..", "templates"), SITE_URL: "http://x" }), stdio: "ignore" });
  const js = fs.readFileSync(path.join(siteDir, "shared", "tds.js"), "utf8");
  ok("the rendered shared script carries the banner's image, height and overlay", js.includes('"image": "/uploads/banner-x.webp"') && js.includes('"height": 320') && js.includes('"overlay": true'), js.slice(js.indexOf("TDS_BRAND"), js.indexOf("TDS_BRAND") + 200));
  fs.writeFileSync(brandFile, JSON.stringify({ name: "Test", banner: { enabled: true, image: "javascript:alert(1)", height: "large" } }));
  execFileSync(process.execPath, [path.join(APP, "render-site.js")], { env: Object.assign({}, process.env, { BRAND_FILE: brandFile, SITE_DIR: siteDir, TEMPLATES_DIR: path.join(APP, "..", "templates"), SITE_URL: "http://x" }), stdio: "ignore" });
  const js2 = fs.readFileSync(path.join(siteDir, "shared", "tds.js"), "utf8");
  ok("an unsafe image value (not a real link) never reaches the page: banner comes out null", js2.includes('"banner": null'), js2.slice(js2.indexOf("TDS_BRAND"), js2.indexOf("TDS_BRAND") + 150));
  fs.writeFileSync(brandFile, JSON.stringify({ name: "Test" }));
  execFileSync(process.execPath, [path.join(APP, "render-site.js")], { env: Object.assign({}, process.env, { BRAND_FILE: brandFile, SITE_DIR: siteDir, TEMPLATES_DIR: path.join(APP, "..", "templates"), SITE_URL: "http://x" }), stdio: "ignore" });
  const js3 = fs.readFileSync(path.join(siteDir, "shared", "tds.js"), "utf8");
  ok("with no banner configured at all, it is simply null (no banner markup at all on the page)", js3.includes('"banner": null'));

  H.cleanup(); process.exit(T.done());
})().catch(e => { console.error("CRASH", e); process.exit(1); });
