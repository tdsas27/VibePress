/* VibePress admin: password + Authy/TOTP two-step login. Listens on 127.0.0.1 only; Nginx proxies /admin/ to it. */
require("dotenv").config();
const express = require("express"), helmet = require("helmet"), cookieSession = require("cookie-session"),
  rateLimit = require("express-rate-limit"), bcrypt = require("bcryptjs"), crypto = require("crypto"),
  fs = require("fs"), path = require("path");
const { authenticator } = require("otplib");

const PORT = process.env.PORT || 3100;
const DATA = path.join(__dirname, "data", "admin.json");
const SESSION_MS = 2 * 60 * 60 * 1000, PENDING_MS = 5 * 60 * 1000;
if ((process.env.SESSION_SECRET || "").length < 32) { console.error("Set SESSION_SECRET (32+ characters) in .env"); process.exit(1); }
authenticator.options = { window: 1 };
const BRAND = process.env.SITE_NAME || "VibePress";                    // white-label: shown in page titles
const SITE_URL = (process.env.SITE_URL || "http://localhost").replace(/\/+$/, "");
const { AsyncLocalStorage } = require("async_hooks"), als = new AsyncLocalStorage(), store = require("./store");
const seoCfg = () => Object.assign({ index: true, description: "", image: "/shared/img/og.jpg" }, store.read("seo.json", {}));
const ld = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, "\\u003c") + "</script>";   // structured data for search engines
const A = "/" + (process.env.ADMIN_PATH || "admin").replace(/^\/+|\/+$/g, "");   // admin address, set in .env
const fixUrl = u => (typeof u === "string" && A !== "/admin" && u.startsWith("/admin")) ? A + u.slice(6) : u;
const fixHtml = b => (typeof b === "string" && A !== "/admin") ? b.split('"/admin').join('"' + A) : b;

const load = () => { try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch { return null; } };
const save = a => fs.writeFileSync(DATA, JSON.stringify(a, null, 2), { mode: 0o600 });
const DUMMY = bcrypt.hashSync("not-a-real-password", 12);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = () => crypto.randomBytes(24).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const csrf = req => (req.session.csrf = req.session.csrf || token());

const robotsTag = o => (o.index && seoCfg().index) ? "" : '<meta name="robots" content="noindex,nofollow">';
const seoTags = (title, o) => {                                       // canonical address and social sharing tags, added to every public page
  const ctx = als.getStore(); if (!o.index || !ctx) return "";
  const h = o.head || "", s = seoCfg(), url = SITE_URL + ctx.path, img = /^https?:/.test(s.image) ? s.image : SITE_URL + s.image;
  let t = `<link rel="canonical" href="${esc(url)}">`;
  if (!h.includes('name="description"') && s.description) t += `<meta name="description" content="${esc(s.description)}">`;
  if (!h.includes('property="og:title"')) t += `<meta property="og:title" content="${esc(title)}">`;
  if (!h.includes('property="og:url"')) t += `<meta property="og:url" content="${esc(url)}">`;
  if (!h.includes('property="og:type"')) t += '<meta property="og:type" content="website">';
  if (!h.includes('property="og:image"')) t += `<meta property="og:image" content="${esc(img)}">`;
  return t + `<meta property="og:site_name" content="${esc(BRAND)}"><meta name="twitter:card" content="summary_large_image">`;
};
const page = (title, body, o = {}) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${robotsTag(o)}${o.head || ""}${seoTags(title, o)}<title>${esc(title)} | ${esc(BRAND)}</title><link rel="stylesheet" href="/shared/tds.css"><style>form{display:grid;gap:.9rem;max-width:24rem}label{display:grid;gap:.3rem;font-weight:600}input{font:inherit;padding:.65rem .8rem;border-radius:.8rem;border:2px solid var(--line);background:var(--card);color:var(--ink)}button{font:inherit;font-weight:700;padding:.7rem 1.2rem;border:0;border-radius:2rem;background:var(--purple);color:var(--onaccent);cursor:pointer}.err{color:var(--red);font-weight:600}</style></head><body><div id="tds-header"></div><main>${body}</main><div id="tds-footer"></div><script src="/shared/tds.js"></script></body></html>`;
const h1 = t => `<h1 class="bubble" style="font-size:clamp(2.2rem,8vw,3.5rem);margin:.5rem 0">${t}</h1>`;
const hidden = req => `<input type="hidden" name="_csrf" value="${csrf(req)}">`;
const loginPage = (req, err) => page("Admin login", `${h1("Admin")}${err ? `<p class="err">${esc(err)}</p>` : ""}<form method="post" action="/admin/login">${hidden(req)}<label>Username<input name="username" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button>Continue</button></form>`);
const verifyPage = (req, err) => page("Two-step check", `${h1("Two-step check")}<p style="color:var(--muted)">Enter the 6-digit code from Authy, or one of your one-time recovery codes.</p>${err ? `<p class="err">${esc(err)}</p>` : ""}<form method="post" action="/admin/verify">${hidden(req)}<label>Code<input name="code" autocomplete="one-time-code" required></label><button>Sign in</button></form>`);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => als.run({ path: req.path }, next));      // lets page() know the address being served
let fw = null;                                       // firewall: runs before everything else
app.use((req, res, next) => fw ? fw.guard(req, res, next) : next());
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://challenges.cloudflare.com"], frameSrc: ["https://challenges.cloudflare.com"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["https://fonts.gstatic.com"], imgSrc: ["'self'", "data:", "https:"], formAction: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(cookieSession({ name: "tds_admin", keys: [process.env.SESSION_SECRET], maxAge: SESSION_MS, httpOnly: true,
  sameSite: "strict", secure: process.env.NODE_ENV === "production", path: A }));
app.use((req, res, next) => {                        // makes every internal /admin link and redirect use the obscure address
  if (A !== "/admin") { const send = res.send.bind(res), red = res.redirect.bind(res);
    res.send = b => send(fixHtml(b)); res.redirect = (a, b) => typeof a === "number" ? red(a, fixUrl(b)) : red(fixUrl(a)); }
  next();
});
const formParser = express.urlencoded({ extended: false, limit: "300kb" });
app.use((req, res, next) => req.originalUrl.startsWith(A + "/pages/save") ? next() : formParser(req, res, next));   // big page forms use their own larger parser

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: "Too many attempts. Wait 15 minutes." });
const verifyCsrf = (req, res, next) => safeEq((req.body && req.body._csrf) || "", csrf(req)) ? next()
  : res.status(403).send(page("Blocked", '<p class="err">Form expired. Go back and reload the page.</p>'));
const requireAuth = (req, res, next) => (req.session.ok && Date.now() - req.session.at < SESSION_MS) ? next() : res.redirect("/admin/login");

const r = express.Router();
r.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

r.get("/login", (req, res) => res.send(loginPage(req)));
r.post("/login", limiter, verifyCsrf, async (req, res) => {
  const a = load();
  const good = await bcrypt.compare(String(req.body.password || ""), a ? a.hash : DUMMY);
  if (a && good && safeEq(String(req.body.username || ""), a.username)) {
    req.session = { pending: Date.now(), csrf: token() };
    return res.redirect("/admin/verify");
  }
  res.status(401).send(loginPage(req, "Wrong username or password."));
});

r.get("/verify", (req, res) => (req.session.pending && Date.now() - req.session.pending < PENDING_MS) ? res.send(verifyPage(req)) : res.redirect("/admin/login"));
r.post("/verify", limiter, verifyCsrf, (req, res) => {
  const s = req.session, a = load();
  if (!a || !s.pending || Date.now() - s.pending > PENDING_MS) { req.session = null; return res.redirect("/admin/login"); }
  const code = String(req.body.code || "").replace(/[\s-]/g, "").toLowerCase();
  let ok = false;
  if (/^\d{6}$/.test(code)) {
    ok = authenticator.check(code, a.totp) && a.lastCode !== code;   // a code can only be used once
    if (ok) { a.lastCode = code; save(a); }
  } else if (/^[0-9a-f]{10}$/.test(code)) {                          // one-time recovery code
    const i = a.recovery.findIndex(h => bcrypt.compareSync(code, h));
    if (i >= 0) { a.recovery.splice(i, 1); save(a); ok = true; }
  }
  if (ok) {
    req.session = { ok: true, at: Date.now(), csrf: token() };
    res.cookie("tds_admin", A, { maxAge: SESSION_MS, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false });   // only the signed-in browser gets this; it just holds the dashboard address
    return res.redirect("/admin/");
  }
  s.tries = (s.tries || 0) + 1;
  if (s.tries >= 5) { req.session = null; return res.redirect("/admin/login"); }
  res.status(401).send(verifyPage(req, "That code was not accepted."));
});

r.get("/", requireAuth, (req, res) => {
  const tiles = [["✍️", "Blog", "var(--purple)", "/admin/blog/"], ["🔗", "Links", "var(--blue)", "/admin/links/"], ["💬", "Feedback", "var(--green)", "/admin/feedback/"], ["📣", "Social posts", "var(--orange)", "/admin/social/"], ["📱", "Apps", "var(--red)", "/admin/apps/"], ["🛡️", "Firewall", "var(--yellow)", "/admin/firewall/"], ["💾", "Backup", "var(--green)", "/admin/backup/"], ["📝", "Pages", "var(--blue)", "/admin/pages/"], ["🦶", "Footer", "var(--orange)", "/admin/site/footer"], ["🔎", "SEO", "var(--green)", "/admin/site/seo"], ["📈", "Traffic", "var(--blue)", "/admin/traffic/"], ["🧭", "Menu", "var(--purple)", "/admin/menu/"], ["🎨", "Theme", "var(--orange)", "/admin/theme/"]]
    .map(([i, n, c, href]) => `<li>${href ? `<a class="card" href="${href}"` : '<div class="card"'} style="--c:${c}"><span class="ico">${i}</span><h2>${n}</h2><p>${href ? "Open" : "Coming next"}</p>${href ? "</a>" : "</div>"}</li>`).join("");
  res.send(page("Dashboard", `${h1("Dashboard")}<p style="color:var(--muted)">You are signed in. Pick a section to manage.</p><ul class="grid">${tiles}</ul><form method="post" action="/admin/logout" style="margin-top:2rem">${hidden(req)}<button>Sign out</button></form>`));
});
r.post("/logout", verifyCsrf, (req, res) => { req.session = null; res.clearCookie("tds_admin", { path: "/" }); res.redirect("/admin/login"); });

const blog = require("./blog")({ page, h1, esc, hidden, verifyCsrf, ld });
r.use("/blog", requireAuth, blog.admin);
const links = require("./links")({ page, h1, esc, hidden, verifyCsrf });
const feedback = require("./feedback")({ page, h1, esc, hidden, verifyCsrf });
r.use("/links", requireAuth, links.admin);
r.use("/feedback", requireAuth, feedback.admin);
app.use("/blog", blog.pub);
app.use("/links", links.pub);
app.use("/go", links.go);
app.use("/feedback", feedback.pub);
const apps = require("./apps")({ page, h1, esc, hidden, verifyCsrf, ld, SITE_URL });
r.use("/apps", requireAuth, apps.admin);
app.use("/apps", apps.pub);
app.use("/get", apps.get);
const images = require("./images")({ page, h1, esc, hidden, verifyCsrf });
r.use("/images", requireAuth, images.admin);
fw = require("./firewall")({ page, h1, esc, hidden, verifyCsrf });
r.use("/firewall", requireAuth, fw.admin);
fw.start();
const traffic = require("./traffic")({ page, h1, esc, A, SITE_URL, country: fw.country });
r.use("/traffic", requireAuth, traffic.admin);
const social = require("./social")({ page, h1, esc, hidden, verifyCsrf, SITE_URL });
r.use("/social", requireAuth, social.admin);
const bk = require("./backup")({ page, h1, esc, hidden, verifyCsrf });
r.use("/backup", requireAuth, bk.admin);
bk.start();
const pages = require("./pages")({ page, h1, esc, hidden, verifyCsrf });
r.use("/pages", requireAuth, pages.admin);
const menu = require("./menu")({ page, h1, esc, hidden, verifyCsrf });
r.use("/menu", requireAuth, menu.admin);
const theme = require("./theme")({ page, h1, esc, hidden, verifyCsrf });
r.use("/theme", requireAuth, theme.admin);
const site = require("./site")({ page, h1, esc, hidden, verifyCsrf, pagesApi: pages, SITE_URL });
r.use("/site", requireAuth, site.admin);
site.start();
app.use(A, r);
app.use((req, res) => res.status(404).send(page("Not found", "<p>Not found.</p>")));
app.listen(PORT, "127.0.0.1", () => console.log("vibepress listening on 127.0.0.1:" + PORT + " (admin at " + A + "/)"));
