/* VibePress shared header + footer. The menu, footer links and brand come from brand.json (see render-site.js). */
// @@BRAND-START (replaced by render-site.js from brand.json)
const TDS_LINKS = [ { label: "Games", href: "/games/" }, { label: "Blog", href: "/blog/" } ];
const TDS_FOOTER_GROUPS = [ { title: "Explore", links: [ { label: "Games", href: "/games/" } ] } ];
const TDS_BRAND = { name: "VibePress", logo: "/shared/img/logo.webp", tagline: "", cta: null, banner: null, credit: true };
// @@BRAND-END
(function () {
  const here = location.pathname;
  const nav = (cls, list = TDS_LINKS) => '<ul class="' + cls + '">' + list.map(l =>
    '<li><a href="' + l.href + '"' + (here.startsWith(l.href) ? ' aria-current="page"' : '') + '>' + l.label + '</a></li>').join("") + '</ul>';
  const isHome = document.body.hasAttribute("data-home"), inPlugin = /^\/x\//.test(here);   // plugin pages: one folder up is /x/, which has no page, so the link must go to the home page
  const h = document.getElementById("tds-header");
  const bn = TDS_BRAND.banner;
  if (h) h.outerHTML = '<header class="tds-header">' +
    (isHome ? '<a class="tds-back bubble" href="/">' + TDS_BRAND.name + '</a>'
            : '<a class="tds-back bubble" href="' + (inPlugin ? '/' : '../') + '">Back To ' + TDS_BRAND.name + '</a>') +
    '<button type="button" class="tds-menu" aria-expanded="false" aria-controls="tds-nav">&#9776; Menu</button>' +
    '<nav id="tds-nav" aria-label="Main">' + nav("tds-nav") + '</nav></header>' +
    (bn ? '<div class="tds-banner' + (bn.overlay ? ' tds-banner-overlay' : '') + '" style="--tds-banner-h:' + bn.height + 'px;background-image:url(\'' + bn.image + '\')" role="img" aria-label=""></div>' : '');
  const am = (() => { try { return document.cookie.match(/(?:^|;\s*)tds_admin=([^;]*)/); } catch (e) { return null; } })(), adminPath = am ? decodeURIComponent(am[1]) : "";   // set only in the owner's browser while signed in
  if (/^\/[\w\-.\/]+$/.test(adminPath)) { const ul = document.querySelector("#tds-nav ul"); if (ul) { const li = document.createElement("li"), a = document.createElement("a"); li.className = "tds-admin"; a.href = adminPath.replace(/\/+$/, "") + "/"; a.textContent = "\u2699 Dashboard"; li.appendChild(a); ul.appendChild(li); } }
  const hd = document.querySelector(".tds-header"), btn = hd && hd.querySelector(".tds-menu");
  if (btn) {                                   // mobile dropdown menu
    const set = o => { hd.classList.toggle("open", o); btn.setAttribute("aria-expanded", o); btn.innerHTML = o ? "&#10005; Close" : "&#9776; Menu"; };
    btn.addEventListener("click", e => { e.stopPropagation(); set(!hd.classList.contains("open")); });
    document.addEventListener("click", e => { if (!hd.contains(e.target)) set(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") set(false); });
    hd.querySelectorAll("nav a").forEach(a => a.addEventListener("click", () => set(false)));
  }
  const f = document.getElementById("tds-footer");
  if (f) f.outerHTML = '<footer class="tds-footer"><div class="tds-foot-top">' +
    '<div class="tds-foot-brand"><a class="tds-foot-logo" href="/"><img src="' + TDS_BRAND.logo + '" alt="" width="64" height="64"><span class="bubble">' + TDS_BRAND.name + '</span></a>' +
    '<p class="tds-tag">' + TDS_BRAND.tagline + '</p>' +
    (TDS_BRAND.cta ? '<a class="tds-cta" href="' + TDS_BRAND.cta.href + '">' + TDS_BRAND.cta.label + '</a>' : '') +
    '<div class="tds-social-row"></div></div>' +
    TDS_FOOTER_GROUPS.map(g => '<nav class="tds-foot-col" aria-label="' + g.title + '"><h3>' + g.title + '</h3>' + nav("tds-links", g.links) + '</nav>').join("") +
    '</div><div class="tds-foot-bar"><p class="tds-copy">&copy; ' + new Date().getFullYear() + ' ' + TDS_BRAND.name +
    (TDS_BRAND.credit !== false ? ' &middot; <a class="tds-credit" href="https://vibepress.tiedyesasquatch.online" rel="noopener">Powered by VibePress</a>' : '') +
    '</p><ul class="tds-legal-row" id="tds-left"></ul><a class="tds-top" href="#">Back to top &uarr;</a></div></footer>';

  // ---- search and sharing tags for hand-uploaded pages that lack them
  const head = document.head, absUrl = location.origin + location.pathname;
  const ensureMeta = (attr, key, val) => { if (val && !document.querySelector("meta[" + attr + '="' + key + '"]')) { const m = document.createElement("meta"); m.setAttribute(attr, key); m.content = val; head.appendChild(m); } };
  if (!document.querySelector('link[rel="canonical"]')) { const l = document.createElement("link"); l.rel = "canonical"; l.href = absUrl; head.appendChild(l); }
  const desc = document.querySelector('meta[name="description"]');
  ensureMeta("property", "og:title", document.title); ensureMeta("property", "og:description", desc && desc.content);
  ensureMeta("property", "og:url", absUrl); ensureMeta("property", "og:type", "website"); ensureMeta("name", "twitter:card", "summary_large_image");

  // ---- footer settings published by the admin: social icons, legal and extra links, tagline, copyright
  fetch("/site.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(c => {
    if (!c) return;
    if (c.image) ensureMeta("property", "og:image", /^https?:/.test(c.image) ? c.image : location.origin + c.image);
    const external = (a, extra) => { if (/^https?:/.test(a.href)) { a.target = "_blank"; a.rel = "noopener noreferrer" + (extra || ""); } };
    const left = document.getElementById("tds-left"), soc = document.querySelector(".tds-social-row"), tag = document.querySelector(".tds-tag"), copy = document.querySelector(".tds-copy"), nameEl = document.querySelector(".tds-foot-logo .bubble");
    const std = ["/privacy/", "/cookies/"], legal = c.legal || [];
    const ordered = legal.filter(x => !std.includes(x.url)).concat(legal.filter(x => std.includes(x.url)));   // your links first, then Privacy and Cookie
    if (left) ordered.forEach(i => { const li = document.createElement("li"), a = document.createElement("a"); a.href = i.url; a.textContent = i.label; external(a); li.appendChild(a); left.appendChild(li); });
    if (soc) (c.social || []).forEach(i => { const a = document.createElement("a"); a.className = "tds-ico"; a.href = i.url; a.textContent = i.icon || i.label.charAt(0); a.title = i.label; a.setAttribute("aria-label", i.label); external(a, " me"); soc.appendChild(a); });
    if (tag && c.tagline) tag.textContent = c.tagline;
    if (nameEl && c.name) nameEl.textContent = c.name;
    if (copy && c.copyright) {                                    // replace only the text; keep the "Powered by" credit
      const cr = copy.querySelector(".tds-credit");
      copy.textContent = c.copyright.replace("{year}", new Date().getFullYear()).replace("{name}", c.name || TDS_BRAND.name);
      if (cr) copy.append(" \u00b7 ", cr);
    }
    if (document.body.hasAttribute("data-home")) {                // structured data for the home page
      const s = document.createElement("script"); s.type = "application/ld+json";
      s.textContent = JSON.stringify([{ "@context": "https://schema.org", "@type": "WebSite", name: c.name, url: location.origin + "/" },
        { "@context": "https://schema.org", "@type": "Organization", name: c.name, url: location.origin + "/", logo: location.origin + "/shared/img/games.webp",
          sameAs: (c.social || []).filter(x => /^https?:/.test(x.url)).map(x => x.url) }]); head.appendChild(s);
    }
  }).catch(() => {});
})();
