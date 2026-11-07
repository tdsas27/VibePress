/* Page creator: write text (Markdown) or HTML pages from the admin into Games, 3D Things, Tools, or the top level of the site.
   Pages are saved as real files (SITE_DIR/<section>/<slug>/index.html) so Nginx serves them fast; the source stays in data/pages.json. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), express = require("express");
const { spawn } = require("child_process");
const { marked } = require("marked"), sanitizeHtml = require("sanitize-html");
const store = require("./store"), UI = require("./ui"), brand = require("./brand");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const FILE = "pages.json", SITE = process.env.SITE_DIR || "/var/www/vibepress/site", BRAND = process.env.SITE_NAME || "VibePress", SITE_URL = (process.env.SITE_URL || "http://localhost").replace(/\/+$/, "");
  const SECTIONS = { games: { name: brand.section("games", "Games"), dir: "games" }, other: { name: brand.section("other", "3D Things"), dir: "other" }, tools: { name: brand.section("tools", "Tools"), dir: "tools" }, root: { name: "Site (top level, like /about/)", dir: "" } };
  const RESERVED = ["shared", "support", "games", "other", "tools", "apps", "blog", "links", "go", "feedback", "get", "uploads", "downloads", "scripts", "signpost", "admin", "backup", "index"];
  const all = () => store.read(FILE), clip = (s, n) => String(s || "").trim().slice(0, n);
  const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const dirOf = p => path.join(SITE, SECTIONS[p.section].dir, p.slug);
  const urlOf = p => "/" + (SECTIONS[p.section].dir ? SECTIONS[p.section].dir + "/" : "") + p.slug + "/";

  const render = md => sanitizeHtml(marked.parse(md || "", { gfm: true }), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: { a: ["href", "title", "rel"], img: ["src", "alt", "title", "width", "height", "loading"] }, allowedSchemes: ["http", "https", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener" }), img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }) } });
  const shell = (p, inner) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} | ${esc(BRAND)}</title>
<meta name="description" content="${esc(p.description || p.title)}">
<link rel="canonical" href="${esc(SITE_URL + urlOf(p))}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(BRAND)}"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description || p.title)}"><meta property="og:url" content="${esc(SITE_URL + urlOf(p))}"><meta property="og:image" content="${esc(SITE_URL)}/shared/img/og.jpg"><meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/shared/tds.css">
<style>.post{max-width:44rem}.post img{max-width:100%;height:auto;border-radius:1rem}.post pre{overflow-x:auto;background:var(--card);padding:1rem;border-radius:1rem}.post code{background:var(--card);padding:.1rem .35rem;border-radius:.4rem}</style>
</head>
<body>
<div id="tds-header"></div>
<main>
${inner}
</main>
<div id="tds-footer"></div>
<script src="/shared/tds.js"></script>
</body>
</html>
`;
  const inject = h => {                                        // adds the site header, footer and theme to a pasted page
    if (!/tds\.css/.test(h)) h = /<\/head>/i.test(h) ? h.replace(/<\/head>/i, () => '<link rel="stylesheet" href="/shared/tds.css">\n</head>') : '<link rel="stylesheet" href="/shared/tds.css">\n' + h;
    if (!/id=["']tds-header["']/.test(h)) h = /<body[^>]*>/i.test(h) ? h.replace(/<body[^>]*>/i, m => m + '\n<div id="tds-header"></div>') : '<div id="tds-header"></div>\n' + h;
    if (!/tds\.js/.test(h)) { const tail = '<div id="tds-footer"></div>\n<script src="/shared/tds.js"></script>\n'; h = /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => tail + "</body>") : h + tail; }
    return h;
  };
  const htmlOf = p => {
    if (p.kind === "text") return shell(p, `<article class="post"><h1 class="bubble" style="font-size:clamp(2.2rem,8vw,4rem);margin:.5rem 0">${esc(p.title)}</h1>${render(p.content)}</article>`);
    const full = /<html[\s>]|<body[\s>]/i.test(p.content);
    if (!full) return p.wrap ? shell(p, p.content) : p.content;
    return p.wrap ? inject(p.content) : p.content;
  };
  const writeFiles = p => {
    const d = dirOf(p); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "index.html"), htmlOf(p));
    fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ icon: p.icon || "", description: p.description || "" }));
  };
  const removeFiles = p => fs.rmSync(dirOf(p), { recursive: true, force: true });
  const rebuild = () => new Promise(ok => {                     // refresh the Games / 3D Things / Tools listings
    const s = path.join(SITE, "scripts", "build-index.js"); if (!fs.existsSync(s)) return ok();
    const c = spawn(process.execPath, [s, SITE], { stdio: "ignore" }); c.on("close", ok); c.on("error", ok);
  });

  const admin = express.Router();
  const editor = (req, p, err) => page(p.id ? "Edit page" : "New page", `${h1(p.id ? "Edit page" : "New page")}${err ? `<p class="err">${esc(err)}</p>` : ""}
<form class="wide" method="post" action="/admin/pages/save">${hidden(req)}<input type="hidden" name="id" value="${esc(p.id || "")}">
<label>Where should it go?<select name="section">${Object.entries(SECTIONS).map(([k, s]) => `<option value="${k}"${p.section === k ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
<label>Title<input name="title" value="${esc(p.title || "")}" required maxlength="100"></label>
<label>Web address name (blank = from title)<input name="slug" value="${esc(p.slug || "")}" maxlength="60"></label>
<label>Short description (shown on the card and in search results)<input name="description" value="${esc(p.description || "")}" maxlength="200"></label>
<label>Card icon (an emoji, optional)<input name="icon" value="${esc(p.icon || "")}" maxlength="8"></label>
<label>Type<select name="kind"><option value="text"${p.kind !== "html" ? " selected" : ""}>Text (Markdown, simple formatting)</option><option value="html"${p.kind === "html" ? " selected" : ""}>HTML (a page or part of a page)</option></select></label>
<label>For HTML: add the site header, footer and theme<select name="wrap"><option value="1"${p.wrap !== false ? " selected" : ""}>Yes (recommended)</option><option value="0"${p.wrap === false ? " selected" : ""}>No, save exactly what I typed</option></select></label>
<label>Status<select name="status"><option value="published"${p.status !== "draft" ? " selected" : ""}>Published</option><option value="draft"${p.status === "draft" ? " selected" : ""}>Draft (hidden)</option></select></label>
<label>Content<textarea name="content" rows="22" required style="width:100%">${esc(p.content || "")}</textarea></label><button>Save page</button></form>
<p class="meta">Text pages use Markdown: # Heading, **bold**, *italic*, [text](https://link), ![alt](https://image), - lists. HTML pages can include scripts and styles, so only paste code you trust.</p>`, { head: UI });

  admin.get("/", (req, res) => res.send(page("Pages", `${h1("Pages")}<p><a class="btn" style="--c:var(--blue)" href="/admin/pages/new">New page</a> <a href="/admin/">&larr; Dashboard</a></p>${all().map(p =>
    `<div class="row"><strong>${esc(p.title)}</strong><span class="meta">${esc(SECTIONS[p.section].name)} | ${p.kind === "html" ? "HTML" : "Text"} | ${p.status}</span>${p.status === "published" ? `<a href="${esc(urlOf(p))}">View</a>` : ""}<a href="/admin/pages/edit/${p.id}">Edit</a><a href="/admin/pages/delete/${p.id}">Delete</a></div>`).join("") || '<p class="note">No pages yet.</p>'}
<form class="inline" method="post" action="/admin/pages/rebuild">${hidden(req)}<button>Rebuild all pages</button></form> <span class="meta">Use this after restoring a data backup.</span>`, { head: UI })));
  admin.get("/new", (req, res) => res.send(editor(req, { section: "tools", kind: "text", status: "published", wrap: true })));
  admin.get("/edit/:id", (req, res) => { const p = all().find(x => x.id === req.params.id); p ? res.send(editor(req, p)) : res.redirect("/admin/pages/"); });
  admin.get("/delete/:id", (req, res) => { const p = all().find(x => x.id === req.params.id); if (!p) return res.redirect("/admin/pages/");
    res.send(page("Delete page", `${h1("Delete this page?")}<p>${esc(p.title)} (${esc(urlOf(p))})</p><form method="post" action="/admin/pages/delete">${hidden(req)}<input type="hidden" name="id" value="${p.id}"><button class="danger">Yes, delete it</button></form><p><a href="/admin/pages/">Cancel</a></p>`, { head: UI })); });
  admin.post("/delete", verifyCsrf, async (req, res) => {
    const list = all(), p = list.find(x => x.id === String(req.body.id || ""));
    if (p) { removeFiles(p); store.write(FILE, list.filter(x => x !== p)); await rebuild(); }
    res.redirect("/admin/pages/");
  });
  admin.post("/rebuild", verifyCsrf, async (req, res) => { all().filter(p => p.status === "published").forEach(writeFiles); await rebuild(); res.redirect("/admin/pages/"); });
  admin.post("/save", express.urlencoded({ extended: false, limit: "5mb" }), verifyCsrf, async (req, res) => {
    const b = req.body, list = all(), old = list.find(x => x.id === String(b.id || "")), now = new Date().toISOString();
    const p = { id: old ? old.id : crypto.randomBytes(5).toString("hex"), section: SECTIONS[b.section] ? b.section : "tools", title: clip(b.title, 100), slug: slugify(b.slug || b.title),
      description: clip(b.description, 200), icon: clip(b.icon, 8), kind: b.kind === "html" ? "html" : "text", wrap: b.wrap !== "0", status: b.status === "draft" ? "draft" : "published",
      content: String(b.content || "").slice(0, 2000000), created: old ? old.created : now, updated: now };
    const fail = m => res.status(400).send(editor(req, p, m));
    if (!p.title || !p.content.trim()) return fail("A title and some content are required.");
    if (!p.slug) return fail("Please use letters or numbers in the title or web address name.");
    if (p.section === "root" && RESERVED.includes(p.slug)) return fail("That top-level name is reserved by the site. Choose another.");
    if (list.some(x => x.id !== p.id && x.section === p.section && x.slug === p.slug)) return fail("Another page already uses that address.");
    if (fs.existsSync(dirOf(p)) && !(old && dirOf(old) === dirOf(p))) return fail("Something already exists at that address on the site. Choose another name.");
    if (old && fs.existsSync(dirOf(old))) removeFiles(old);
    if (p.status === "published") writeFiles(p);
    store.write(FILE, old ? list.map(x => x === old ? p : x) : list.concat(p));
    await rebuild(); res.redirect("/admin/pages/");
  });
  const ensure = async p => {                                   // used by the footer builder to create the policy pages
    const list = all(), now = new Date().toISOString();
    if (list.some(x => x.section === p.section && x.slug === p.slug)) return "exists";
    const rec = { id: crypto.randomBytes(5).toString("hex"), section: p.section, title: p.title, slug: p.slug, description: p.description || "", icon: "", kind: "text", wrap: true, status: "published", content: p.content, created: now, updated: now };
    if (fs.existsSync(dirOf(rec))) return "blocked";
    writeFiles(rec); store.write(FILE, list.concat(rec)); await rebuild(); return "created";
  };
  return { admin, ensure };
};
