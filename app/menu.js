/* Admin > Menu: edit the top menu (header links) without touching brand.json by hand. */
const express = require("express"), fs = require("fs"), path = require("path");
const store = require("./store"), UI = require("./ui"), brandfile = require("./brandfile");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const SITE = process.env.SITE_DIR || "/var/www/vibepress/site";
  const LINK = /^(\/[\w\-./?=&#%]*|https:\/\/\S+)$/, MAX = 12;
  const title = (k, d) => { const s = ((brandfile.read().sections || {})[k] || {}).title; return s || d; };
  const defaults = () => [{ label: title("games", "Games"), href: "/games/" }, { label: title("other", "3D Things"), href: "/other/" }, { label: title("tools", "Tools"), href: "/tools/" },
    { label: "Apps", href: "/apps/" }, { label: "Blog", href: "/blog/" }, { label: "Links", href: "/links/" }];
  const choices = () => {                                  // pages that can be added with one click
    const c = [["Home", "/"], [title("games", "Games"), "/games/"], [title("other", "3D Things"), "/other/"], [title("tools", "Tools"), "/tools/"], ["Apps", "/apps/"], ["Blog", "/blog/"], ["Links", "/links/"], ["Feedback", "/feedback/"]];
    if (fs.existsSync(path.join(SITE, "support", "index.html"))) c.push(["Support", "/support/"]);
    store.read("pages.json").filter(p => p.status === "published").forEach(p => c.push([p.title, "/" + (p.section === "root" ? "" : p.section + "/") + p.slug + "/"]));
    try { require("./plugins/registry").list().filter(p => p.enabled).forEach(p => p.pages.forEach(g => c.push([g.title, g.url]))); } catch { /* plugins not set up yet */ }
    return c;
  };
  const current = () => { const n = brandfile.read().nav; return Array.isArray(n) ? n.map(l => ({ label: String(l.label || ""), href: String(l.href || "") })) : defaults(); };

  const view = (req, msg, ok, items) => page("Menu", `${h1("Menu")}<p><a href="/admin/">&larr; Dashboard</a></p>
${msg ? `<p class="err">${esc(msg)}</p>` : ""}${ok ? '<p class="note" style="margin-top:0">Saved. Your site menu is updated (hard-refresh the site if you do not see it).</p>' : ""}
<p class="meta">This is the top menu of your site. Add a page, rename or re-order links, and remove the ones you do not want. Up to ${MAX} links. A signed-in Dashboard link is added automatically for you.</p>
<form class="wide" method="post" action="/admin/menu/save" id="menuform">${hidden(req)}
<ul id="mlist" class="mlist" data-items="${esc(JSON.stringify(items || current()))}" data-max="${MAX}"></ul>
<noscript><p class="err">This page needs JavaScript to edit the menu.</p></noscript>
<div class="row" style="border:0"><select id="mpick" aria-label="Page to add">${choices().map(([t, h]) => `<option value="${esc(h)}">${esc(t)} (${esc(h)})</option>`).join("")}</select>
<button type="button" id="madd">+ Add this page</button><button type="button" id="mblank">+ Add a custom link</button></div>
<p class="meta">A custom link can be a page on your site like <code>/about/</code> or a full address like <code>https://example.com</code>.</p>
<button>Save menu</button></form>
<form class="inline" method="post" action="/admin/menu/reset" style="margin-top:1.2rem">${hidden(req)}<button class="danger" data-confirm="Put the menu back to the standard links?">Reset to standard menu</button></form>
<style>.mlist{list-style:none;padding:0;margin:1rem 0;display:grid;gap:.6rem}.mrow{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.mrow input{flex:1;min-width:9rem}.mrow input.mh{flex:2;min-width:12rem}.mrow button{padding:.45rem .8rem}</style>
<script src="/shared/admin-menu.js" defer></script>`, { head: UI });

  const admin = express.Router();
  admin.get("/", (req, res) => res.send(view(req, "", req.query.saved === "1")));
  admin.post("/save", verifyCsrf, async (req, res) => {
    const one = v => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(x => String(x).trim());
    const L = one(req.body.label), H = one(req.body.href), items = [];
    for (let i = 0; i < L.length; i++) { if (!L[i] && !H[i]) continue; items.push({ label: L[i].replace(/[<>"]/g, "").slice(0, 40), href: H[i].slice(0, 300) }); }
    if (items.length > MAX) return res.status(400).send(view(req, `Please keep the menu to ${MAX} links or fewer.`, false, items));
    const bad = items.find(i => !i.label || !LINK.test(i.href));
    if (bad) return res.status(400).send(view(req, `Check "${bad.label || bad.href || "an empty row"}": every link needs a label and an address that starts with / or https://`, false, items));
    const b = brandfile.read(); b.nav = items; brandfile.write(b);
    const r = await brandfile.render();
    if (!r.ok) { brandfile.undo(); return res.status(500).send(view(req, "The site could not be rebuilt, so nothing was changed. " + r.message, false, items)); }
    res.redirect("/admin/menu/?saved=1");
  });
  admin.post("/reset", verifyCsrf, async (req, res) => {
    const b = brandfile.read(); b.nav = defaults(); brandfile.write(b); await brandfile.render(); res.redirect("/admin/menu/?saved=1");
  });
  return { admin };
};
