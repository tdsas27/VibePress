/* Site settings in the admin: footer builder (social links, legal links), SEO settings, sitemap.xml + robots.txt, default policy pages. */
const fs = require("fs"), path = require("path"), express = require("express");
const brand = require("./brand"), brandfile = require("./brandfile"), store = require("./store"), UI = require("./ui"), policies = require("./policies");

module.exports = ({ page, h1, esc, hidden, verifyCsrf, pagesApi, SITE_URL }) => {
  const SITE = process.env.SITE_DIR || "/var/www/vibepress/site";
  const SOCIAL = [["twitch", "Twitch", "🎮"], ["itch", "itch.io", "🕹️"], ["youtube", "YouTube", "▶️"], ["x", "X", "✖️"], ["bluesky", "Bluesky", "🦋"], ["instagram", "Instagram", "📷"],
    ["tiktok", "TikTok", "🎵"], ["facebook", "Facebook", "👍"], ["discord", "Discord", "💬"], ["github", "GitHub", "🐙"], ["mastodon", "Mastodon", "🐘"],
    ["patreon", "Patreon", "❤️"], ["kofi", "Ko-fi", "☕"], ["bmac", "Buy Me A Coffee", "☕"], ["email", "Email", "✉️"]];
  const clip = (s, n) => String(s || "").trim().slice(0, n);
  const footer = () => Object.assign({ copyright: "© {year} {name}", tagline: "", contact: "", social: {}, legal: { privacy: true, cookies: true }, links: [] }, store.read("footer.json", {}));
  const seo = () => Object.assign({ index: true, description: "", image: "/shared/img/og.jpg" }, store.read("seo.json", {}));
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

  const publishFooter = () => {                                   // writes the public /site.json that the site footer reads
    const c = footer();
    const out = { name: brand.name, copyright: String(c.copyright).replace(/\{name\}/g, brand.name), tagline: c.tagline, image: seo().image,
      social: SOCIAL.filter(([k]) => c.social[k] && c.social[k].show && c.social[k].url).map(([k, n, i]) => ({ label: n, icon: i, url: k === "email" ? "mailto:" + c.social[k].url : c.social[k].url })),
      legal: [c.legal.privacy && { label: "Privacy Policy", url: "/privacy/" }, c.legal.cookies && { label: "Cookie Policy", url: "/cookies/" }].filter(Boolean).concat(c.links) };
    try { fs.writeFileSync(path.join(SITE, "site.json"), JSON.stringify(out)); } catch (e) { console.error("site: cannot write site.json: " + e.message); }
  };
  const writeSeo = () => {                                        // sitemap.xml and robots.txt
    const s = seo(), seen = new Set(), urls = [];
    const add = (p, t) => { if (!seen.has(p)) { seen.add(p); urls.push([SITE_URL + p, t]); } };
    ["/", "/games/", "/other/", "/tools/", "/apps/", "/blog/", "/links/", "/support/", "/feedback/"].forEach(p => add(p));
    ["games", "other", "tools"].forEach(sec => ((readJson(path.join(SITE, sec, "projects.json")) || {}).items || []).forEach(i => add(i.href, i.updated)));
    try { fs.readdirSync(path.join(__dirname, "data", "posts")).filter(f => f.endsWith(".json")).forEach(f => { const p = readJson(path.join(__dirname, "data", "posts", f)); if (p && p.status === "published") add("/blog/" + p.slug, p.updated); }); } catch {}
    store.read("apps.json").forEach(a => add("/apps/" + a.slug, a.releases && a.releases[0] && a.releases[0].date));
    store.read("pages.json").filter(p => p.status === "published" && p.section === "root").forEach(p => add("/" + p.slug + "/", p.updated));
    const x = v => String(v).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(([l, t]) => `<url><loc>${x(l)}</loc>${t ? `<lastmod>${x(String(t).slice(0, 10))}</lastmod>` : ""}</url>`).join("\n") + "\n</urlset>\n";
    const robots = s.index ? `User-agent: *\nAllow: /\nDisallow: /get/\nDisallow: /go/\nDisallow: /scripts/\nDisallow: /downloads/\n\nSitemap: ${SITE_URL}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
    try { fs.writeFileSync(path.join(SITE, "sitemap.xml"), xml); fs.writeFileSync(path.join(SITE, "robots.txt"), robots); } catch (e) { console.error("seo: cannot write sitemap/robots: " + e.message); }
    return urls.length;
  };
  const health = () => {
    const out = [];
    ["games", "other", "tools"].forEach(sec => ((readJson(path.join(SITE, sec, "projects.json")) || {}).items || []).filter(i => !i.description).forEach(i => out.push(`${i.title} (${i.href}): add a description`)));
    store.read("pages.json").filter(p => p.status === "published" && !p.description).forEach(p => out.push(`Page "${p.title}": add a description`));
    store.read("apps.json").filter(a => !a.tagline || !a.description).forEach(a => out.push(`App "${a.name}": add a tagline and description`));
    store.read("apps.json").filter(a => !(a.screens || []).length).forEach(a => out.push(`App "${a.name}": add screenshots`));
    return out;
  };

  const admin = express.Router();
  const footerView = async (req, msg) => {
    const c = footer(), have = k => store.read("pages.json").some(p => p.section === "root" && p.slug === k);
    return page("Footer builder", `${h1("Footer")}<p><a href="/admin/">&larr; Dashboard</a></p>${msg ? `<p class="err">${esc(msg)}</p>` : ""}
<form class="wide" method="post" action="/admin/site/footer">${hidden(req)}
<label>Copyright line ({year} becomes the current year, {name} your site name)<input name="copyright" value="${esc(c.copyright)}" maxlength="160"></label>
<label>Short blurb next to your logo (optional; blank = the default line)<input name="tagline" value="${esc(c.tagline)}" maxlength="160"></label>
<label>Contact email (used inside the privacy and cookie policies; not shown unless you tick Email below)<input name="contact" value="${esc(c.contact)}" maxlength="120"></label>
<h3 class="cat">Social links: tick the ones that should show</h3>
${SOCIAL.map(([k, n, i]) => { const s = c.social[k] || {}; return `<div class="row"><label style="display:flex;gap:.5rem;align-items:center;min-width:11rem"><input type="checkbox" name="show_${k}" value="1" style="width:auto"${s.show ? " checked" : ""}> ${i} ${n}</label><input name="url_${k}" value="${esc(s.url || "")}" placeholder="${k === "email" ? "you@example.com" : "https://..."}" maxlength="200" style="flex:1;min-width:14rem"></div>`; }).join("")}
<h3 class="cat">Legal links (shown in the footer's bottom bar)</h3>
<label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="show_privacy" value="1" style="width:auto"${c.legal.privacy ? " checked" : ""}> Show Privacy Policy (/privacy/)</label>
<label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="show_cookies" value="1" style="width:auto"${c.legal.cookies ? " checked" : ""}> Show Cookie Policy (/cookies/)</label>
<h3 class="cat">Extra footer links (optional, shown in the bottom bar before the legal links)</h3>
${[0, 1, 2].map(i => `<div class="row"><input name="ll${i}" value="${esc((c.links[i] || {}).label || "")}" placeholder="Label" maxlength="40"><input name="lu${i}" value="${esc((c.links[i] || {}).url || "")}" placeholder="https://... or /page/" maxlength="200" style="flex:1;min-width:14rem"></div>`).join("")}
<button>Save footer</button></form>
<h3 class="cat">Privacy and cookie policies</h3>
<p class="meta">Privacy Policy: <strong>${have("privacy") ? "created" : "not created yet"}</strong> &nbsp; Cookie Policy: <strong>${have("cookies") ? "created" : "not created yet"}</strong>. They are starter texts written to match what this site does. Edit them any time in <a href="/admin/pages/">Pages</a>, and have them checked for your situation, especially if you add analytics or ads.</p>
<form class="inline" method="post" action="/admin/site/policies">${hidden(req)}<button>Create the missing policy pages</button></form>`, { head: UI });
  };
  /* ---- Site name: one place to rename the site (header, footer, page titles, search results) ---- */
  const nameView = (req, msg, ok) => { const b = brandfile.read();
    return page("Site name", `${h1("Site name")}<p><a href="/admin/">&larr; Dashboard</a></p>${msg ? `<p class="err">${esc(msg)}</p>` : ""}${ok ? `<p class="note" style="margin-top:0">${esc(ok)}</p>` : ""}
<form class="wide" method="post" action="/admin/site/name">${hidden(req)}
<label>Site name (shown in the header, the footer, browser tabs and search results)<input name="name" value="${esc(brand.name)}" maxlength="60" required></label>
<label>Home page title (the browser-tab and search-result title of the home page; blank = the site name)<input name="title" value="${esc(brand.homeTitle())}" maxlength="70" placeholder="${esc(brand.name)}"></label>
<label>Tagline (the line under the big name on the home page; also the home page's search description)<input name="tagline" value="${esc(b.tagline || "")}" maxlength="160"></label>
<button>Save and rebuild the site</button></form>
<p class="meta">Saving rebuilds the home page, the header and footer, and your page titles. Your own text is left alone: privacy and cookie policies, blog posts and pages you wrote keep any place you typed the old name by hand, so edit those in <a href="/admin/pages/">Pages</a> if needed. Hard-refresh your site afterwards.</p>`, { head: UI }); };
  admin.get("/name", (req, res) => res.send(nameView(req, "", req.query.done ? "Saved. The site was rebuilt with the new name; hard-refresh your site to see it." : "")));
  admin.post("/name", verifyCsrf, async (req, res) => {
    const name = brand.clean(req.body.name).slice(0, 60), title = brand.clean(req.body.title).slice(0, 70), tagline = brand.clean(req.body.tagline).slice(0, 160), old = brand.name;
    if (!name) return res.status(400).send(nameView(req, "Please enter a site name."));
    const b = brandfile.read(); b.name = name; b.tagline = tagline; b.home = Object.assign({}, b.home, { title });
    brandfile.write(b);
    const stored = store.read("footer.json", null);                           // a copyright line that still has the old name typed in follows the rename
    if (stored && stored.copyright === "© {year} " + old) { stored.copyright = "© {year} {name}"; store.write("footer.json", stored); }
    const r = await brandfile.render();
    publishFooter();
    const e = x => String(x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    for (const sec of ["games", "other", "tools"]) {                          // section pages made earlier have the old name in their <title>
      const f = path.join(SITE, sec, "index.html"); try { const h = fs.readFileSync(f, "utf8"), t = h.replace(/(<title>[^<]*\| )([^<]*)(<\/title>)/, (m, a, n, z) => n === e(old) ? a + e(name) + z : m); if (t !== h) fs.writeFileSync(f, t); } catch { /* no such page */ }
    }
    try { if (pagesApi && pagesApi.rebuildAll) await pagesApi.rebuildAll(); } catch { /* pages keep the old name until Rebuild all pages */ }
    if (!r.ok) return res.status(500).send(nameView(req, "The name was saved, but the site could not be rebuilt: " + r.message + " Try Admin > Theme > Rebuild site now."));
    res.redirect("/admin/site/name?done=1");
  });
  admin.get("/footer", async (req, res) => res.send(await footerView(req)));
  admin.post("/footer", verifyCsrf, async (req, res) => {
    const b = req.body, c = { copyright: clip(b.copyright, 160) || "© {year} {name}", tagline: clip(b.tagline, 160), contact: clip(b.contact, 120), social: {},
      legal: { privacy: b.show_privacy === "1", cookies: b.show_cookies === "1" }, links: [] };
    for (const [k, n] of SOCIAL) {
      const u = clip(b["url_" + k], 200);
      if (u && !(k === "email" ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u) : /^https:\/\/\S+$/.test(u))) return res.status(400).send(await footerView(req, `Check the ${n} entry: ${k === "email" ? "enter an email address" : "the address must start with https://"}.`));
      c.social[k] = { url: u, show: !!u && b["show_" + k] === "1" };
    }
    for (let i = 0; i < 3; i++) {
      const l = clip(b["ll" + i], 40), u = clip(b["lu" + i], 200); if (!l && !u) continue;
      if (!l || !/^(https:\/\/\S+|\/[\w\-./]*)$/.test(u)) return res.status(400).send(await footerView(req, "Extra links need a label and an address that starts with https:// or /."));
      c.links.push({ label: l, url: u });
    }
    store.write("footer.json", c); publishFooter(); res.redirect("/admin/site/footer");
  });
  admin.post("/policies", verifyCsrf, async (req, res) => {
    const c = footer(), v = { name: brand.name, domain: SITE_URL.replace(/^https?:\/\//, ""), contact: c.contact ? `[${c.contact}](mailto:${c.contact})` : "[the feedback form](/feedback/)",
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) };
    await pagesApi.ensure({ section: "root", slug: "privacy", title: "Privacy Policy", description: `How ${brand.name} handles your information.`, content: policies.privacy(v) });
    await pagesApi.ensure({ section: "root", slug: "cookies", title: "Cookie Policy", description: `How ${brand.name} uses cookies.`, content: policies.cookies(v) });
    writeSeo(); res.redirect("/admin/site/footer");
  });

  const seoView = (req, msg) => { const s = seo(), h = health();
    return page("SEO", `${h1("SEO")}<p><a href="/admin/">&larr; Dashboard</a></p>${msg ? `<p class="err">${esc(msg)}</p>` : ""}
<form class="wide" method="post" action="/admin/site/seo">${hidden(req)}
<label>Let search engines list the site<select name="index"><option value="1"${s.index ? " selected" : ""}>Yes</option><option value="0"${s.index ? "" : " selected"}>No (hide from search)</option></select></label>
<label>Default description (used when a page has none)<input name="description" value="${esc(s.description)}" maxlength="200"></label>
<label>Share image address (shown on social media; 1200x630 works best)<input name="image" value="${esc(s.image)}" maxlength="200"></label><button>Save SEO settings</button></form>
<form class="inline" method="post" action="/admin/site/seo-regen">${hidden(req)}<button>Rebuild sitemap and robots.txt now</button></form>
<p class="meta">Your sitemap: <a href="/sitemap.xml" target="_blank">${esc(SITE_URL)}/sitemap.xml</a> &nbsp; robots.txt: <a href="/robots.txt" target="_blank">${esc(SITE_URL)}/robots.txt</a>. They rebuild by themselves every hour.</p>
<h3 class="cat">Health check</h3>${h.length ? h.map(x => `<div class="row">${esc(x)}</div>`).join("") : '<p class="note">Every listing has the basics. Nice.</p>'}
<h3 class="cat">Next steps</h3><p class="meta">1. In Google Search Console, add your site and submit the sitemap address above. 2. Do the same in Bing Webmaster Tools. 3. Keep each page's title and description short and specific.</p>`, { head: UI }); };
  admin.get("/seo", (req, res) => res.send(seoView(req)));
  admin.post("/seo", verifyCsrf, (req, res) => {
    const image = clip(req.body.image, 200) || "/shared/img/og.jpg";
    if (!/^(\/[\w\-./]+|https:\/\/\S+)$/.test(image)) return res.status(400).send(seoView(req, "The share image must start with / or https://"));
    store.write("seo.json", { index: req.body.index !== "0", description: clip(req.body.description, 200), image }); writeSeo(); publishFooter(); res.redirect("/admin/site/seo");
  });
  admin.post("/seo-regen", verifyCsrf, (req, res) => { writeSeo(); publishFooter(); res.redirect("/admin/site/seo"); });

  const start = () => { publishFooter(); writeSeo(); setInterval(writeSeo, 3600e3).unref(); };
  return { admin, start };
};
