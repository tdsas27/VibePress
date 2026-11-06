#!/usr/bin/env node
/* VibePress site renderer. Reads brand.json and builds the branded static files:
   theme CSS, header/footer script, home page and support page.   Usage: node render-site.js
   Folders (defaults): brand.json and templates/ and site/ next to the app folder. */
const fs = require("fs"), path = require("path");
const ROOT = process.env.VP_ROOT || path.resolve(__dirname, "..");
const BRAND_FILE = process.env.BRAND_FILE || path.join(ROOT, "brand.json"), TPL = process.env.TEMPLATES_DIR || path.join(ROOT, "templates"), SITE = process.env.SITE_DIR || path.join(ROOT, "site");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let B; try { B = JSON.parse(fs.readFileSync(BRAND_FILE, "utf8")); } catch (e) { console.error("Cannot read " + BRAND_FILE + ": " + e.message); process.exit(1); }
const name = String(B.name || "VibePress"), tagline = String(B.tagline || ""), url = (process.env.SITE_URL || (B.domain ? "https://" + B.domain : "")).replace(/\/+$/, "");
const read = f => fs.readFileSync(path.join(TPL, f), "utf8"), write = (f, s) => { const p = path.join(SITE, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); console.log("wrote " + f); };
const hex = /^#[0-9a-fA-F]{3,8}$/, link = /^(\/[\w\-./?=&#%]*|https:\/\/\S+)$/, COLORS = ["red", "orange", "yellow", "green", "blue", "purple"];
const clean = (list, fb) => (Array.isArray(list) ? list : fb).filter(l => l && l.label && link.test(String(l.href || ""))).map(l => ({ label: String(l.label).slice(0, 40), href: l.href }));

/* 1. theme CSS: base + colour and font overrides */
const vars = ["bg", "card", "ink", "muted", "red", "orange", "yellow", "green", "blue", "purple"].filter(k => (B.colors || {})[k] && hex.test(B.colors[k])).map(k => `--${k}:${B.colors[k]};`).join("");
const fam = /^[\w \-]+$/.test((B.font || {}).family || "") ? B.font.family : "Fredoka";
const imp = "import" in (B.font || {}) ? B.font.import : "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap";
write("shared/tds.css", (/^https:\/\/\S+$/.test(imp || "") ? `@import url("${imp}");\n` : "") + read("shared/tds.base.css") + `\n:root{${vars}--font:"${fam}","Trebuchet MS",system-ui,sans-serif;}\n`);

/* 2. header and footer script */
const nav = clean(B.nav, [{ label: "Games", href: "/games/" }, { label: "Blog", href: "/blog/" }]);
const groups = ((B.footer || {}).groups || [{ title: "Explore", links: nav }]).map(g => ({ title: String(g.title || "").slice(0, 30), links: clean(g.links, []) })).filter(g => g.title && g.links.length);
const cta = (B.footer || {}).cta && link.test(B.footer.cta.href || "") ? { label: String(B.footer.cta.label || "Support us").slice(0, 40), href: B.footer.cta.href } : null;
const brandObj = { name, logo: link.test(B.logo || "") ? B.logo : "/shared/img/logo.webp", tagline, cta };
const block = `// @@BRAND-START (replaced by render-site.js from brand.json)\nconst TDS_LINKS = ${JSON.stringify(nav, null, 2)};\nconst TDS_FOOTER_GROUPS = ${JSON.stringify(groups, null, 2)};\nconst TDS_BRAND = ${JSON.stringify(brandObj, null, 2)};\n// @@BRAND-END`;
const t = read("shared/tds.template.js"), a = t.indexOf("// @@BRAND-START"), z = t.indexOf("// @@BRAND-END");
if (a < 0 || z < 0) { console.error("tds.template.js is missing its brand markers"); process.exit(1); }
write("shared/tds.js", t.slice(0, a) + block + t.slice(z + "// @@BRAND-END".length));

/* 3. home page */
const cards = ((B.home || {}).cards || []).filter(c => c && c.title && link.test(c.href || "")).map((c, i) =>
  `<li><a class="card" style="--c:var(--${COLORS.includes(c.color) ? c.color : COLORS[i % 6]})" href="${esc(c.href)}">${c.image && link.test(c.image) ? `<img class="pic" src="${esc(c.image)}" alt="" width="120" height="120">` : ""}<h2>${esc(c.title)}</h2><p>${esc(c.text || "")}</p></a></li>`).join("\n    ");
const len = Math.max(8, name.length), title = String((B.home || {}).title || name);
write("index.html", read("index.template.html").replace(/{{TITLE}}/g, esc(title)).replace(/{{NAME}}/g, esc(name)).replace(/{{DESC}}/g, esc(tagline)).replace(/{{TAGLINE}}/g, esc(tagline))
  .replace(/{{URL}}/g, esc(url)).replace("{{CARDS}}", cards).replace("{{FS_VW}}", (128 / len).toFixed(1)).replace("{{FS_CQI}}", (142 / len).toFixed(1)).replace("{{WS}}", name.length > 24 ? "normal" : "nowrap"));

/* 4. support page (only when "support" is set in brand.json) */
const S = B.support;
if (S && typeof S === "object") {
  const quick = (S.buttons || []).filter(b => b && b.label && /^https:\/\/\S+$/.test(b.url || "")).map((b, i) =>
    `<a class="big" style="background:var(--${COLORS.includes(b.color) ? b.color : COLORS[(i + 2) % 6]});--c:var(--orange)" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.label)}<small>${esc(b.sub || "")}</small></a>`).join("\n    ");
  const crypto = (S.crypto || []).filter(c => c && c.coin && /^[\w:.\-]{10,120}$/.test(c.address || "")).map((c, i) =>
    `<li><div class="card" style="--c:var(--${COLORS[(i + 4) % 6]})"><h3>${esc(c.coin)}</h3><p class="net">${esc(c.network || "")}</p><div class="qr" data-qr="${esc(c.address)}"></div><code>${esc(c.address)}</code><button type="button" class="btn copy" data-copy="${esc(c.address)}">Copy address</button></div></li>`).join("");
  write("support/index.html", read("support.template.html").replace(/{{NAME}}/g, esc(name)).replace(/{{URL}}/g, esc(url)).replace("{{INTRO}}", esc(S.intro || "If something made your day, a tip helps keep it going. Thank you!"))
    .replace("{{QUICK}}", quick ? `<div class="quick">\n    ${quick}\n  </div>` : "").replace("{{CRYPTO}}", crypto ? `<h2 class="bubble" style="font-size:2rem;margin:0 0 .3rem">Crypto</h2>\n  <p style="color:var(--muted)">Scan the code or copy the address. Send each coin only on its own network, since an address from one network cannot receive another.</p>\n  <ul class="grid">${crypto}</ul>` : ""));
}
console.log("Done. Hard-refresh your browser to see changes.");
