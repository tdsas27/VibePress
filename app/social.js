/* Social post creator: write once, get ready-to-post text for each network (with limits, hashtags, tracked links, share buttons) and a downloadable share card image. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), express = require("express");
const store = require("./store"), UI = require("./ui");

module.exports = ({ page, h1, esc, hidden, verifyCsrf, SITE_URL }) => {
  const SITE = process.env.SITE_DIR || "/var/www/vibepress/site", FILE = "social.json", all = () => store.read(FILE), enc = encodeURIComponent;
  const clip = (s, n) => String(s || "").trim().slice(0, n);
  const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const tagsOf = s => [...new Set(String(s || "").split(/[,\s]+/).map(t => t.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean))].slice(0, 15);
  const PLATS = [
    { k: "x", n: "X / Twitter", limit: 280, linkLen: 23, tags: 2, intent: (t, u) => `https://twitter.com/intent/tweet?text=${enc(t)}&url=${enc(u)}` },
    { k: "bluesky", n: "Bluesky", limit: 300, tags: 3, intent: (t, u, f) => `https://bsky.app/intent/compose?text=${enc(f)}` },
    { k: "mastodon", n: "Mastodon", limit: 500, tags: 5, note: "Paste this into your Mastodon server's compose box." },
    { k: "threads", n: "Threads", limit: 500, tags: 1, intent: (t, u, f) => `https://www.threads.net/intent/post?text=${enc(f)}` },
    { k: "facebook", n: "Facebook", limit: 5000, tags: 3, intent: (t, u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}`, note: "Facebook builds the preview from the link. Paste the text above it into the post." },
    { k: "linkedin", n: "LinkedIn", limit: 3000, tags: 3, intent: (t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}`, note: "Paste the text into the post box that opens." },
    { k: "reddit", n: "Reddit", limit: 300, tags: 0, title: true, intent: (t, u) => `https://www.reddit.com/submit?url=${enc(u)}&title=${enc(t)}`, note: "Reddit uses the text as the post title. Read each subreddit's self-promotion rules first." },
    { k: "instagram", n: "Instagram", limit: 2200, tags: 12, nolink: true, note: "Links are not clickable in captions. Download the share card image below and post it with this caption." },
    { k: "discord", n: "Discord", limit: 2000, tags: 0 },
    { k: "telegram", n: "Telegram", limit: 4096, tags: 2, intent: (t, u) => `https://t.me/share/url?url=${enc(u)}&text=${enc(t)}` },
    { k: "whatsapp", n: "WhatsApp", limit: 4096, tags: 0, intent: (t, u, f) => `https://wa.me/?text=${enc(f)}` }
  ];
  const tracked = (link, k, camp) => { try { const u = new URL(link); u.searchParams.set("utm_source", k); u.searchParams.set("utm_medium", "social"); if (camp) u.searchParams.set("utm_campaign", camp); return u.href; } catch { return link; } };
  const build = (p, message, link, tags, utm, camp) => {            // text for one network, trimmed to its limit
    const url = p.nolink || !link ? "" : (utm ? tracked(link, p.k, camp) : link), tg = tags.slice(0, p.tags).map(t => "#" + t).join(" ");
    if (p.title) return { text: message.length > p.limit ? message.slice(0, p.limit - 1).replace(/\s+\S*$/, "") + "…" : message, url, count: Math.min(message.length, p.limit), full: message, tail: "" };
    const tail = [tg, p.nolink ? "Link in bio" : url].filter(Boolean).join("\n"), tailCost = (tg ? tg.length + 1 : 0) + (p.nolink ? 11 + (tg ? 1 : 0) : url ? (p.linkLen || url.length) + (tg ? 1 : 0) : 0);
    const room = Math.max(20, p.limit - tailCost - (tail ? 2 : 0));
    const msg = message.length > room ? message.slice(0, room - 1).replace(/\s+\S*$/, "") + "…" : message;
    const text = tail ? msg + "\n\n" + tail : msg, xText = tg ? msg + "\n\n" + tg : msg;
    return { text, url, count: msg.length + (tail ? 2 : 0) + tailCost, full: text, xText };
  };

  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  const plain = md => String(md || "").replace(/[#*_`>\[\]()!~-]/g, "").replace(/\s+/g, " ").trim();
  const sources = () => {                                           // things on the site you can post about
    const out = [], secDir = { games: "/games/", other: "/other/", tools: "/tools/", root: "/" };
    try { fs.readdirSync(path.join(__dirname, "data", "posts")).filter(f => f.endsWith(".json")).forEach(f => { const p = readJson(path.join(__dirname, "data", "posts", f));
      if (p && p.status === "published") out.push({ key: "blog:" + p.slug, label: "Blog: " + p.title, title: p.title, message: "New post: " + p.title + ". " + plain(p.body).slice(0, 110), link: SITE_URL + "/blog/" + p.slug, tags: (p.tags || []).join(",") }); }); } catch {}
    store.read("apps.json").forEach(a => out.push({ key: "app:" + a.slug, label: "App: " + a.name, title: a.name, message: a.name + ": " + (a.tagline || ""), link: SITE_URL + "/apps/" + a.slug, tags: "apps" }));
    ["games", "other", "tools"].forEach(s => ((readJson(path.join(SITE, s, "projects.json")) || {}).items || []).forEach(i =>
      out.push({ key: s + ":" + i.href, label: ({ games: "Game", other: "3D", tools: "Tool" })[s] + ": " + i.title, title: i.title, message: i.title + ": " + (i.description || ""), link: SITE_URL + i.href, tags: s === "games" ? "indiegame,gamedev" : "" })));
    store.read("pages.json").filter(p => p.status === "published").forEach(p => out.push({ key: "page:" + p.id, label: "Page: " + p.title, title: p.title, message: p.title + ": " + (p.description || ""), link: SITE_URL + (secDir[p.section] || "/") + p.slug + "/", tags: "" }));
    return out;
  };

  const admin = express.Router();
  const view = (req, st, results, err) => {
    const src = sources(), saved = all().slice().reverse();
    return page("Social posts", `${h1("Social posts")}<p><a href="/admin/">&larr; Dashboard</a></p>${err ? `<p class="err">${esc(err)}</p>` : ""}
<form class="inline" method="get" action="/admin/social/"><label style="display:inline-grid">Start from something on the site<select name="src" style="max-width:100%">${src.map(s => `<option value="${esc(s.key)}"${st.srcKey === s.key ? " selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label> <button>Fill in</button></form>
<form class="wide" method="post" action="/admin/social/preview" style="margin-top:1rem">${hidden(req)}<input type="hidden" name="id" value="${esc(st.id || "")}">
<label>Title (used on Reddit and the share card)<input name="title" value="${esc(st.title || "")}" maxlength="120"></label>
<label>Message<textarea name="message" rows="5" maxlength="2000" required>${esc(st.message || "")}</textarea></label>
<label>Link (https://...)<input name="link" value="${esc(st.link || "")}" maxlength="400"></label>
<label>Hashtags (separate with commas or spaces)<input name="tags" value="${esc(st.tags || "")}" maxlength="200"></label>
<label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="utm" value="1" style="width:auto"${st.utm !== false ? " checked" : ""}> Tag each link so the Traffic page shows which network sent visitors</label>
<div><button>Preview posts</button> <button formaction="/admin/social/save" class="danger" style="background:var(--green)!important">Save draft</button></div></form>
${results ? `<h3 class="cat">Ready to post</h3>${results.map(r => `<div class="card" style="--c:${r.over ? "var(--red)" : "var(--blue)"};margin:1rem 0"><div class="row" style="border:0;padding:0"><strong>${esc(r.p.n)}</strong><span class="meta"${r.over ? ' style="color:var(--red)"' : ""}>${r.count} of ${r.p.limit}</span>${r.posted ? '<span class="badge" style="background:var(--green)">posted</span>' : ""}</div>
<textarea id="t-${r.p.k}" class="snip" readonly rows="${Math.min(10, Math.max(3, Math.ceil(r.full.length / 60) + 1))}" style="width:100%">${esc(r.full)}</textarea>
<p><button type="button" data-copy-target="t-${r.p.k}">Copy</button> ${r.intent ? `<a class="btn" style="--c:var(--blue)" href="${esc(r.intent)}" target="_blank" rel="noopener noreferrer">Open in ${esc(r.p.n)}</a>` : ""}
${st.id ? `<form class="inline" method="post" action="/admin/social/mark">${hidden(req)}<input type="hidden" name="id" value="${esc(st.id)}"><input type="hidden" name="k" value="${r.p.k}"><button>${r.posted ? "Unmark posted" : "Mark as posted"}</button></form>` : ""}</p>${r.p.note ? `<p class="meta">${esc(r.p.note)}</p>` : ""}${r.p.title && r.url ? `<p class="meta">Link to add: ${esc(r.url)}</p>` : ""}</div>`).join("")}` : ""}
<h3 class="cat">Share card image</h3>
<p class="meta">Make a picture for Instagram, stories, or any post. It is drawn in your browser and downloads as a PNG.</p>
<div class="row"><label>Size<select id="sc-size"><option value="1200x630">Wide (links, X, Facebook)</option><option value="1080x1080">Square (Instagram)</option><option value="1080x1920">Tall (stories)</option></select></label>
<label>Picture<select id="sc-art"><option value="/shared/img/logo.webp">Logo</option><option value="/shared/img/games.webp">Games art</option><option value="/shared/img/3d.webp">3D art</option><option value="/shared/img/tools.webp">Tools art</option><option value="/shared/img/apps.webp">Apps art</option><option value="/shared/img/blog.webp">Blog art</option></select></label></div>
<div class="row"><label>Card title<input id="sc-title" value="${esc(st.title || "")}" maxlength="90"></label><label>Small line<input id="sc-sub" value="${esc(st.sub || "")}" maxlength="90" placeholder="${esc(process.env.SITE_NAME || "VibePress")}"></label><button type="button" id="sc-dl">Download PNG</button></div>
<canvas id="sc-canvas" width="1200" height="630" style="max-width:100%;height:auto;border-radius:1rem;border:2px solid #3b3463"></canvas>
<h3 class="cat">Saved drafts</h3>${saved.map(s => `<div class="row"><strong>${esc(s.title || s.message.slice(0, 40))}</strong><span class="meta">${new Date(s.created).toLocaleDateString("en-US", { dateStyle: "medium" })}${Object.keys(s.posted || {}).filter(k => s.posted[k]).length ? " | posted: " + Object.keys(s.posted).filter(k => s.posted[k]).join(", ") : ""}</span><a href="/admin/social/?load=${esc(s.id)}">Open</a><form class="inline" method="post" action="/admin/social/delete">${hidden(req)}<input type="hidden" name="id" value="${esc(s.id)}"><button class="danger">Delete</button></form></div>`).join("") || '<p class="note">No saved drafts yet.</p>'}
<script src="/shared/admin-copy.js"></script><script src="/shared/social-card.js"></script>`, { head: UI });
  };
  const results = (st, id) => {
    const tags = tagsOf(st.tags), camp = slug(st.title || st.message), posted = (all().find(x => x.id === id) || {}).posted || {};
    return PLATS.map(p => { const b = build(p, st.message, st.link, tags, st.utm !== false, camp);
      return { p, text: b.text, full: b.full, count: b.count, url: b.url, over: b.count > p.limit, posted: !!posted[p.k], intent: p.intent ? p.intent(b.xText || b.text, b.url || st.link || "", b.full) : "" }; });
  };
  const fromBody = b => ({ id: clip(b.id, 20), title: clip(b.title, 120), message: clip(b.message, 2000), link: clip(b.link, 400), tags: clip(b.tags, 200), utm: b.utm === "1", sub: "" });
  const linkOk = l => !l || /^https?:\/\/\S+$/.test(l);

  admin.get("/", (req, res) => {
    let st = { utm: true };
    if (req.query.src) { const s = sources().find(x => x.key === String(req.query.src)); if (s) st = { title: s.title, message: s.message, link: s.link, tags: s.tags, utm: true, srcKey: s.key }; }
    if (req.query.load) { const s = all().find(x => x.id === String(req.query.load)); if (s) return res.send(view(req, s, results(s, s.id))); }
    res.send(view(req, st, null));
  });
  admin.post("/preview", verifyCsrf, (req, res) => {
    const st = fromBody(req.body);
    if (!st.message) return res.status(400).send(view(req, st, null, "Write a message first."));
    if (!linkOk(st.link)) return res.status(400).send(view(req, st, null, "The link must start with https://"));
    res.send(view(req, st, results(st, st.id)));
  });
  admin.post("/save", verifyCsrf, (req, res) => {
    const st = fromBody(req.body), list = all();
    if (!st.message) return res.status(400).send(view(req, st, null, "Write a message first."));
    if (!linkOk(st.link)) return res.status(400).send(view(req, st, null, "The link must start with https://"));
    const old = list.find(x => x.id === st.id), rec = { id: old ? old.id : crypto.randomBytes(5).toString("hex"), title: st.title, message: st.message, link: st.link, tags: st.tags, utm: st.utm, created: old ? old.created : new Date().toISOString(), posted: old ? old.posted || {} : {} };
    store.write(FILE, old ? list.map(x => x === old ? rec : x) : list.concat(rec)); res.redirect("/admin/social/?load=" + rec.id);
  });
  admin.post("/mark", verifyCsrf, (req, res) => {
    const list = all(), s = list.find(x => x.id === String(req.body.id || "")), k = String(req.body.k || "");
    if (s && PLATS.some(p => p.k === k)) { s.posted = s.posted || {}; s.posted[k] = !s.posted[k]; store.write(FILE, list); }
    res.redirect("/admin/social/" + (s ? "?load=" + s.id : ""));
  });
  admin.post("/delete", verifyCsrf, (req, res) => { store.write(FILE, all().filter(x => x.id !== String(req.body.id || ""))); res.redirect("/admin/social/"); });
  return { admin, _build: build, _plats: PLATS };
};
