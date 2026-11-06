/* Links: public list at /links/, click-counting redirects at /go/<slug>, editor at /admin/links/. */
const express = require("express");
const store = require("./store"), UI = require("./ui");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const FILE = "links.json";
  const all = () => store.read(FILE);
  const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const okUrl = u => { try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; } };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const COLORS = ["var(--red)", "var(--orange)", "var(--yellow)", "var(--green)", "var(--blue)", "var(--purple)"];

  const pub = express.Router();
  pub.get("/", (req, res) => {
    const groups = {};
    all().forEach(l => (groups[l.category || "Other"] = groups[l.category || "Other"] || []).push(l));
    let n = 0;
    const body = Object.keys(groups).sort().map(cat => `<h3 class="cat">${esc(cat)}</h3><ul class="grid">${groups[cat].map(l =>
      `<li><a class="card" style="--c:${COLORS[n++ % 6]}" href="/go/${esc(l.slug)}" target="_blank" rel="noopener noreferrer"><h2>${esc(l.title)}</h2><p>${esc(l.description || "")}</p><p class="meta">${esc(host(l.url))}</p></a></li>`).join("")}</ul>`).join("");
    res.set("Cache-Control", "public, max-age=60");
    res.send(page("Links", `${h1("Links")}<p class="meta">Friends, tools and things worth a visit.</p>${body || '<p class="note">No links yet.</p>'}`, { index: true, head: UI }));
  });

  const go = express.Router();
  go.get("/:slug", (req, res) => {
    const l = all(), i = l.findIndex(x => x.slug === req.params.slug);
    if (i < 0) return res.status(404).send(page("Not found", "<p>That link was not found.</p>"));
    l[i].clicks = (l[i].clicks || 0) + 1; store.write(FILE, l);
    res.set("Cache-Control", "no-store").redirect(302, l[i].url);
  });

  const admin = express.Router();
  const editor = (req, l, err) => page(l.slug ? "Edit link" : "New link", `${h1(l.slug ? "Edit link" : "New link")}${err ? `<p class="err">${esc(err)}</p>` : ""}
<form method="post" action="/admin/links/save">${hidden(req)}<input type="hidden" name="oldSlug" value="${esc(l.slug || "")}">
<label>Title<input name="title" value="${esc(l.title || "")}" required maxlength="80"></label>
<label>Destination URL (https://...)<input name="url" value="${esc(l.url || "")}" required maxlength="500"></label>
<label>Short description<input name="description" value="${esc(l.description || "")}" maxlength="200"></label>
<label>Category<input name="category" value="${esc(l.category || "")}" maxlength="40" placeholder="Friends, Tools, Shops..."></label>
<label>Short name for /go/ link (blank = from title)<input name="slug" value="${esc(l.slug || "")}" maxlength="60"></label><button>Save</button></form>`, { head: UI });

  admin.get("/", (req, res) => res.send(page("Links admin", `${h1("Links")}<p><a class="btn" style="--c:var(--blue)" href="/admin/links/new">New link</a> <a href="/admin/">&larr; Dashboard</a></p>${all().map(l =>
    `<div class="row"><strong>${esc(l.title)}</strong><span class="meta">${esc(l.category || "Other")}</span><span class="meta">/go/${esc(l.slug)}</span><span class="meta">${l.clicks || 0} clicks</span><a href="/admin/links/edit/${esc(l.slug)}">Edit</a><a href="/admin/links/delete/${esc(l.slug)}">Delete</a></div>`).join("") || '<p class="note">No links yet.</p>'}`, { head: UI })));
  admin.get("/new", (req, res) => res.send(editor(req, {})));
  admin.get("/edit/:slug", (req, res) => { const l = all().find(x => x.slug === req.params.slug); l ? res.send(editor(req, l)) : res.redirect("/admin/links/"); });
  admin.get("/delete/:slug", (req, res) => { const l = all().find(x => x.slug === req.params.slug); if (!l) return res.redirect("/admin/links/");
    res.send(page("Delete link", `${h1("Delete this link?")}<p>${esc(l.title)}</p><form method="post" action="/admin/links/delete">${hidden(req)}<input type="hidden" name="slug" value="${esc(l.slug)}"><button class="danger">Yes, delete it</button></form><p><a href="/admin/links/">Cancel</a></p>`, { head: UI })); });
  admin.post("/delete", verifyCsrf, (req, res) => { store.write(FILE, all().filter(x => x.slug !== String(req.body.slug || ""))); res.redirect("/admin/links/"); });

  admin.post("/save", verifyCsrf, (req, res) => {
    const b = req.body, list = all(), oldSlug = String(b.oldSlug || ""), old = list.find(x => x.slug === oldSlug);
    const l = { title: String(b.title || "").trim().slice(0, 80), url: String(b.url || "").trim().slice(0, 500), description: String(b.description || "").trim().slice(0, 200),
      category: String(b.category || "").trim().slice(0, 40), clicks: old ? old.clicks || 0 : 0 };
    l.slug = slugify(b.slug || l.title) || "link-" + Date.now();
    if (!l.title) return res.status(400).send(editor(req, l, "A title is required."));
    if (!okUrl(l.url)) return res.status(400).send(editor(req, l, "The URL must start with http:// or https://"));
    if (l.slug !== oldSlug && list.some(x => x.slug === l.slug)) return res.status(400).send(editor(req, l, "That short name is already used."));
    store.write(FILE, old ? list.map(x => x.slug === oldSlug ? l : x) : list.concat(l));
    res.redirect("/admin/links/");
  });
  return { pub, go, admin };
};
