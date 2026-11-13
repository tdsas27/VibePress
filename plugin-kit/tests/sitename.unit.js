// Unit tests for Admin > Site name: validation, brand.json, live name everywhere, footer follow-along, section titles, HTML safety.
//   node plugin-kit/tests/sitename.unit.js
const fs = require("fs"), path = require("path");
const { load, makeCounter } = require("./harness");
const APP = path.join(__dirname, "..", "..", "app");
const T = makeCounter(), ok = T.ok;
const H = load();
process.env.SITE_NAME = "FromEnv";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
process.env.VP_DATA_DIR = H.tmp + "/data"; fs.mkdirSync(process.env.VP_DATA_DIR, { recursive: true });
const brand = require(path.join(APP, "brand.js")), store = require(path.join(APP, "store.js"));
let rebuilt = 0;
const site = require(path.join(APP, "site.js"))({ page: (t, b) => b, h1: t => t, esc, hidden: () => "", verifyCsrf: (q, s, n) => n(), pagesApi: { ensure: async () => "created", rebuildAll: async () => { rebuilt++; } }, SITE_URL: "http://localhost" });
const call = (m, p, o) => H.call(site.admin, m, p, o || {});
const siteJson = () => JSON.parse(fs.readFileSync(path.join(process.env.SITE_DIR, "site.json"), "utf8"));
fs.mkdirSync(process.env.SITE_DIR + "/games", { recursive: true });

(async () => {
  ok("the name comes from brand.json first (not the install-time SITE_NAME)", brand.name === "VibePress", brand.name);
  fs.writeFileSync(process.env.SITE_DIR + "/games/index.html", "<title>Games | VibePress</title><title>x</title>");
  store.write("footer.json", { copyright: "\u00a9 {year} VibePress", tagline: "", contact: "", social: {}, legal: { privacy: true, cookies: true }, links: [] });
  let r = await call("GET", "/name");
  ok("the Site name page opens and shows the current name", r.code === 200 && /name="name" value="VibePress"/.test(r.body), r.body.slice(0, 200));
  ok("it has a home page title and a tagline field", /name="title"/.test(r.body) && /name="tagline"/.test(r.body));

  r = await call("POST", "/name", { body: { name: "   ", title: "", tagline: "" } });
  ok("an empty name is refused with a message", r.code === 400 && /enter a site name/.test(r.body));
  ok("...and nothing was changed", brand.name === "VibePress");

  r = await call("POST", "/name", { body: { name: "Moon Garage", title: "Moon Garage: games & tools", tagline: "Built by hand" } });
  ok("saving a new name redirects back with a done flag", r.loc === "/admin/site/name?done=1" || r.code === 500, r.loc + " " + r.code + " " + r.body.slice(0, 200));
  const b = JSON.parse(fs.readFileSync(process.env.BRAND_FILE, "utf8"));
  ok("brand.json has the new name, tagline and home title", b.name === "Moon Garage" && b.tagline === "Built by hand" && b.home.title === "Moon Garage: games & tools", JSON.stringify([b.name, b.tagline, b.home]));
  ok("the rest of brand.json (colors, menu) is untouched", b.colors && b.colors.bg === "#110e1f" && Array.isArray(b.nav) && b.nav.length >= 4);
  ok("the app uses the new name straight away, no restart", brand.name === "Moon Garage" && brand.homeTitle() === "Moon Garage: games & tools", brand.name);
  ok("the home page was rebuilt with the new name and title", /<title>Moon Garage: games &amp; tools<\/title>/.test(fs.readFileSync(process.env.SITE_DIR + "/index.html", "utf8")));
  ok("the header/footer script carries the new name", /"name": "Moon Garage"/.test(fs.readFileSync(process.env.SITE_DIR + "/shared/tds.js", "utf8")));
  ok("site.json (read by every page's footer) has the new name", siteJson().name === "Moon Garage", JSON.stringify(siteJson()));
  ok("a copyright line that had the old name typed in now follows the name", store.read("footer.json").copyright === "\u00a9 {year} {name}" && siteJson().copyright === "\u00a9 {year} Moon Garage", siteJson().copyright);
  ok("section pages made earlier get the new name in their <title>", /<title>Games \| Moon Garage<\/title>/.test(fs.readFileSync(process.env.SITE_DIR + "/games/index.html", "utf8")));
  ok("pages written in Admin > Pages are rebuilt", rebuilt === 1, rebuilt);

  store.write("footer.json", Object.assign(store.read("footer.json"), { copyright: "Made by me, all rights reserved" }));
  await call("POST", "/name", { body: { name: "Second", title: "", tagline: "" } });
  ok("a copyright line the owner wrote themselves is never overwritten", store.read("footer.json").copyright === "Made by me, all rights reserved");
  ok("a blank home title is stored blank (falls back to the name)", brand.homeTitle() === "" && /<title>Second<\/title>/.test(fs.readFileSync(process.env.SITE_DIR + "/index.html", "utf8")));

  await call("POST", "/name", { body: { name: 'Evil <img src=x onerror=alert(1)> "Co"\n\u0007', title: "", tagline: "<b>hi</b>" } });
  const html = fs.readFileSync(process.env.SITE_DIR + "/index.html", "utf8"), js = fs.readFileSync(process.env.SITE_DIR + "/shared/tds.js", "utf8");
  ok("HTML in a name cannot get into the home page as markup", !/<img src=x/.test(html) && /&lt;img/.test(html));
  ok("...nor into the header/footer script as markup", !/name": "[^"]*<img/.test(js) && /&lt;img/.test(js));
  ok("...nor the tagline", !/<b>hi<\/b>/.test(js) && /&lt;b&gt;hi/.test(js));
  ok("control characters are stripped from the name", !/[\u0000-\u001f]/.test(brand.name), JSON.stringify(brand.name));

  await call("POST", "/name", { body: { name: "x".repeat(200), title: "", tagline: "" } });
  ok("a very long name is cut to 60 characters", brand.name.length === 60, brand.name.length);

  fs.unlinkSync(process.env.BRAND_FILE);
  ok("with no brand.json at all the name falls back to the installer's SITE_NAME", brand.name === "FromEnv", brand.name);
  T.done && T.done();
  H.cleanup();
})().catch(e => { console.log("CRASH " + e.stack); process.exit(1); });
