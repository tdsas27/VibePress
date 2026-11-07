/* Blog: public pages at /blog/, editor at /admin/blog/. Posts are JSON files in data/posts (easy to back up). */
const fs = require("fs"), path = require("path");
const express = require("express");
const { marked } = require("marked");
const sanitizeHtml = require("sanitize-html");

module.exports = ({ page, h1, esc, hidden, verifyCsrf, ld }) => {
  const BRAND = process.env.SITE_NAME || "VibePress";
  const DIR = path.join(__dirname, "data", "posts");
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const SITE = process.env.SITE_URL || "http://localhost";

  const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const file = slug => path.join(DIR, slug + ".json");
  const get = slug => { if (!/^[a-z0-9-]+$/.test(slug)) return null; try { return JSON.parse(fs.readFileSync(file(slug), "utf8")); } catch { return null; } };
  const all = () => fs.readdirSync(DIR).filter(f => f.endsWith(".json"))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { return null; } }).filter(Boolean)
    .sort((a, b) => (b.published || b.updated).localeCompare(a.published || a.updated));
  const live = () => all().filter(p => p.status === "published");
  const date = iso => iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";

  const render = md => sanitizeHtml(marked.parse(md || "", { gfm: true }), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: { a: ["href", "title", "rel"], img: ["src", "alt", "title", "width", "height", "loading"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener" }), img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }) }
  });
  const excerpt = p => sanitizeHtml(render(p.body), { allowedTags: [] }).replace(/\s+/g, " ").trim().slice(0, 180);
  const tagLinks = p => (p.tags || []).map(t => `<a class="tag" href="/blog/tag/${esc(slugify(t))}">${esc(t)}</a>`).join("");

  const CSS = '<style>.post{max-width:42rem}.post h2,.post h3{margin-top:2rem}.post img{max-width:100%;height:auto;border-radius:1rem}.post pre{overflow-x:auto;background:var(--card);padding:1rem;border-radius:1rem}.post code{background:var(--card);padding:.1rem .35rem;border-radius:.4rem}.meta{color:var(--muted);font-size:.95rem}.tag{display:inline-block;margin:.2rem .3rem 0 0;padding:.1rem .7rem;border-radius:2rem;border:2px solid var(--line);color:var(--ink);text-decoration:none;font-size:.9rem}.row{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;padding:.8rem 0;border-bottom:1px solid var(--line)}.row form{display:inline;max-width:none}.badge{padding:.1rem .6rem;border-radius:2rem;font-size:.85rem;font-weight:700;color:var(--onaccent)}textarea,select{font:inherit;padding:.65rem .8rem;border-radius:.8rem;border:2px solid var(--line);background:var(--card);color:var(--ink)}textarea{font-family:ui-monospace,Consolas,monospace;font-size:1rem}form.wide{max-width:none}.danger{background:var(--red)!important}</style>';

  /* ---------- public ---------- */
  const pub = express.Router();
  pub.use((req, res, next) => { res.set("Cache-Control", "public, max-age=60"); next(); });

  const listPage = (title, intro, posts, extra = "") => page(title, `<img class="sec-img" src="/shared/img/blog.webp" alt="" width="140" height="140">${h1(esc(title))}<p class="meta">${intro}</p>${posts.length ? posts.map(p =>
    `<article class="card" style="--c:var(--purple);margin:1.2rem 0"><h2><a href="/blog/${esc(p.slug)}" style="color:inherit;text-decoration:none">${esc(p.title)}</a></h2><p class="meta">${date(p.published)}</p><p>${esc(excerpt(p))}</p><div>${tagLinks(p)}</div></article>`).join("") : '<p class="note">No posts yet. Check back soon.</p>'}`,
    { index: true, head: CSS + '<link rel="alternate" type="application/rss+xml" title="' + BRAND + ' Blog" href="/blog/rss.xml">' + extra });

  pub.get("/", (req, res) => res.send(listPage("Blog", "News, how-tos and behind the scenes. <a href=\"/blog/rss.xml\">RSS feed</a>", live(),
    '<meta name="description" content="News, how-tos and behind the scenes from ' + BRAND + '.">')));
  const UPLOADS = process.env.UPLOAD_DIR || "/var/www/vibepress/site/uploads";
  const thumbOf = src => { const m = /^\/uploads\/([0-9a-f]{16})\.\w+$/.exec(src); return m && fs.existsSync(path.join(UPLOADS, m[1] + "-t.webp")) ? "/uploads/" + m[1] + "-t.webp" : src; };
  const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  pub.get("/recent.json", (req, res) => {                          // used by the home page and section pages to show latest posts
    const want = String(req.query.tags || "").split(",").map(slugify).filter(Boolean), limit = Math.min(3, Math.max(1, parseInt(req.query.limit, 10) || 3));
    const posts = live().filter(p => !want.length || (p.tags || []).some(t => want.includes(slugify(t)))).slice(0, limit).map(p => {
      const html = render(p.body), img = /<img[^>]+src="([^"]+)"/.exec(html), full = unesc(sanitizeHtml(html, { allowedTags: [] })).replace(/\s+/g, " ").trim();
      return { title: p.title, url: "/blog/" + p.slug, date: p.published || p.updated, thumb: img ? thumbOf(unesc(img[1])) : "", tags: p.tags || [],
        excerpt: full.length > 200 ? full.slice(0, 200).replace(/\s+\S*$/, "") + "…" : full };
    });
    res.set("Cache-Control", "public, max-age=60").json(posts);
  });
  pub.get("/rss.xml", (req, res) => {
    const x = s => String(s).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
    const items = live().slice(0, 20).map(p => `<item><title>${x(p.title)}</title><link>${SITE}/blog/${p.slug}</link><guid>${SITE}/blog/${p.slug}</guid><pubDate>${new Date(p.published).toUTCString()}</pubDate><description>${x(excerpt(p))}</description></item>`).join("");
    res.type("application/rss+xml").send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${BRAND} Blog</title><link>${SITE}/blog/</link><description>News, how-tos and behind the scenes.</description>${items}</channel></rss>`);
  });
  pub.get("/tag/:tag", (req, res) => {
    const t = slugify(req.params.tag);
    res.send(listPage("Tag: " + t, '<a href="/blog/">All posts</a>', live().filter(p => (p.tags || []).some(x => slugify(x) === t))));
  });
  const postPage = (p, banner = "") => page(p.title, `${banner}<article class="post">${h1(esc(p.title))}<p class="meta">${date(p.published || p.updated)}</p><div>${tagLinks(p)}</div>${render(p.body)}</article><p><a href="/blog/">&larr; All posts</a></p>`,
    { index: true, head: CSS + `<meta name="description" content="${esc(excerpt(p))}"><meta property="og:type" content="article"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(excerpt(p))}"><meta property="og:url" content="${SITE}/blog/${esc(p.slug)}">` + ld({ "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, datePublished: p.published || p.updated, dateModified: p.updated, description: excerpt(p), mainEntityOfPage: SITE + "/blog/" + p.slug, publisher: { "@type": "Organization", name: process.env.SITE_NAME || "VibePress" } }) });
  pub.get("/:slug", (req, res) => {
    const p = get(req.params.slug);
    if (!p || p.status !== "published") return res.status(404).send(page("Not found", "<p>That post was not found.</p>"));
    res.send(postPage(p));
  });

  /* ---------- admin (mounted behind login at /admin/blog) ---------- */
  const admin = express.Router();
  const editor = (req, p, err) => page(p.slug ? "Edit post" : "New post", `${h1(p.slug ? "Edit post" : "New post")}${err ? `<p class="err">${esc(err)}</p>` : ""}
<form class="wide" method="post" action="/admin/blog/save">${hidden(req)}<input type="hidden" name="oldSlug" value="${esc(p.slug || "")}">
<label>Title<input name="title" value="${esc(p.title || "")}" required maxlength="140"></label>
<label>Slug (the web address; leave blank to build it from the title)<input name="slug" value="${esc(p.slug || "")}" maxlength="80"></label>
<label>Tags (comma separated)<input name="tags" value="${esc((p.tags || []).join(", "))}"></label>
<label>Status<select name="status"><option value="draft"${p.status !== "published" ? " selected" : ""}>Draft</option><option value="published"${p.status === "published" ? " selected" : ""}>Published</option></select></label>
<label>Post (Markdown)<textarea name="body" rows="18" required>${esc(p.body || "")}</textarea></label><button>Save</button></form>
<p class="meta">Markdown cheatsheet: # Heading, **bold**, *italic*, [text](https://link), ![alt](https://image-url), - lists, \`code\`. Save, then use Preview from the list. <a href="/admin/images/" target="_blank">Upload or find images</a> to paste in.</p>`, { head: CSS });

  admin.get("/", (req, res) => res.send(page("Blog admin", `${h1("Blog")}<p><a class="btn" style="--c:var(--purple)" href="/admin/blog/new">New post</a> <a href="/admin/">&larr; Dashboard</a></p>${all().map(p => `<div class="row"><strong>${esc(p.title)}</strong><span class="badge" style="background:${p.status === "published" ? "var(--green)" : "var(--yellow)"}">${p.status}</span><span class="meta">${date(p.updated)}</span><a href="/admin/blog/edit/${esc(p.slug)}">Edit</a><a href="/admin/blog/preview/${esc(p.slug)}">Preview</a>${p.status === "published" ? `<a href="/blog/${esc(p.slug)}">View</a>` : ""}<a href="/admin/blog/delete/${esc(p.slug)}">Delete</a></div>`).join("") || '<p class="note">No posts yet.</p>'}`, { head: CSS })));
  admin.get("/new", (req, res) => res.send(editor(req, { status: "draft" })));
  admin.get("/edit/:slug", (req, res) => { const p = get(req.params.slug); p ? res.send(editor(req, p)) : res.redirect("/admin/blog/"); });
  admin.get("/preview/:slug", (req, res) => { const p = get(req.params.slug); p ? res.send(postPage(p, '<p class="note">Preview. Only you can see this page.</p>')) : res.redirect("/admin/blog/"); });
  admin.get("/delete/:slug", (req, res) => { const p = get(req.params.slug); if (!p) return res.redirect("/admin/blog/");
    res.send(page("Delete post", `${h1("Delete this post?")}<p>${esc(p.title)}</p><form method="post" action="/admin/blog/delete">${hidden(req)}<input type="hidden" name="slug" value="${esc(p.slug)}"><button class="danger">Yes, delete it</button></form><p><a href="/admin/blog/">Cancel</a></p>`, { head: CSS })); });
  admin.post("/delete", verifyCsrf, (req, res) => { const s = String(req.body.slug || ""); if (get(s)) fs.unlinkSync(file(s)); res.redirect("/admin/blog/"); });

  admin.post("/save", verifyCsrf, (req, res) => {
    const b = req.body, old = get(String(b.oldSlug || ""));
    const title = String(b.title || "").trim().slice(0, 140), body = String(b.body || "").slice(0, 200000);
    const draft = { title, slug: slugify(b.slug || title) || "post-" + Date.now(), status: b.status === "published" ? "published" : "draft", body,
      tags: String(b.tags || "").split(",").map(t => t.trim()).filter(Boolean).slice(0, 10), published: old ? old.published : null };
    if (!title || !body.trim()) return res.status(400).send(editor(req, draft, "A title and some text are required."));
    if (draft.slug !== (old && old.slug) && get(draft.slug)) return res.status(400).send(editor(req, draft, "That slug is already used by another post."));
    const now = new Date().toISOString();
    draft.updated = now;
    if (draft.status === "published" && !draft.published) draft.published = now;
    fs.writeFileSync(file(draft.slug), JSON.stringify(draft, null, 2), { mode: 0o600 });
    if (old && old.slug !== draft.slug) fs.unlinkSync(file(old.slug));
    res.redirect("/admin/blog/");
  });

  return { pub, admin };
};
