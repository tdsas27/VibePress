#!/usr/bin/env node
/* VibePress auto-lister. No dependencies.
   Usage:  node build-index.js /var/www/vibepress/site      (site root; defaults to current folder)
   Scans /games, /other, /tools for project folders (with index.html) or loose .html files,
   then writes projects.json in each section, a latest.json at the root, and a section index.html if one is missing.
   Per-project overrides: meta.json in the folder (or name.meta.json beside a loose file):
   { "title": "", "description": "", "icon": "🎲", "color": "var(--green)", "order": 1, "hidden": true } */
const fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2] || ".");
let BR = {}; try { BR = JSON.parse(fs.readFileSync(process.env.BRAND_FILE || path.join(root, "..", "brand.json"), "utf8")); } catch { /* defaults */ }
const SITE_NAME = BR.name || "VibePress";
const DEFAULTS = {
  games: { title: "Games", tags: ["games", "game"], image: "/shared/img/games.webp", intro: "Play in your browser. No install needed." },
  other: { title: "3D Things", tags: ["3d", "3d-things", "3d-printing", "printing"], image: "/shared/img/3d.webp", intro: "Parametric designs you can tweak and export for printing." },
  tools: { title: "Tools", tags: ["tools", "tool"], image: "/shared/img/tools.webp", intro: "Small utilities that do one job well." }
};
const SECTIONS = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, Object.assign({}, v, (BR.sections || {})[k] || {})]));
const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}} | {{SITE}}</title>
<meta name="description" content="{{INTRO}}">
<link rel="stylesheet" href="/shared/tds.css">
</head>
<body>
<div id="tds-header"></div>
<main>
  <h1 class="bubble" style="font-size:clamp(2.4rem,9vw,4.5rem);margin:.5rem 0">{{TITLE}}</h1>
  <p id="intro" style="color:var(--muted);max-width:40rem">{{INTRO}}</p>
  <ul class="grid" id="projects"></ul>
</main>
<div id="tds-footer"></div>
<script src="/shared/tds.js"></script>
<script src="/shared/section.js"></script>
</body>
</html>
`;
const read = f => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const pretty = s => s.replace(/\.html?$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const meta = (html, name) => {
  const a = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', "i"));
  const b = html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*name=["\']' + name + '["\']', "i"));
  return ((a || b || [])[1] || "").trim();
};
const latest = [];
for (const [dir, cfg] of Object.entries(SECTIONS)) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) continue;
  const items = [];
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (e.name.startsWith(".") || ["index.html", "projects.json"].includes(e.name)) continue;
    let htmlFile, metaFile, href;
    if (e.isDirectory()) {
      htmlFile = path.join(base, e.name, "index.html");
      if (!fs.existsSync(htmlFile)) continue;
      metaFile = path.join(base, e.name, "meta.json"); href = "/" + dir + "/" + e.name + "/";
    } else if (/\.html?$/i.test(e.name)) {
      htmlFile = path.join(base, e.name);
      metaFile = htmlFile.replace(/\.html?$/i, ".meta.json"); href = "/" + dir + "/" + e.name;
    } else continue;
    const html = read(htmlFile); let m = {};
    try { m = JSON.parse(read(metaFile)); } catch {}
    if (m.hidden) continue;
    const t = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    items.push({
      title: m.title || (t && t.trim()) || pretty(e.name),
      description: m.description || meta(html, "description"),
      icon: m.icon || "", color: m.color || "", order: m.order ?? 999, href,
      updated: fs.statSync(htmlFile).mtime.toISOString()
    });
  }
  items.sort((a, b) => a.order - b.order || b.updated.localeCompare(a.updated));
  fs.writeFileSync(path.join(base, "projects.json"), JSON.stringify({ section: cfg.title, image: cfg.image, feedTags: cfg.tags, intro: cfg.intro, items }, null, 2));
  const idx = path.join(base, "index.html");
  if (!fs.existsSync(idx)) fs.writeFileSync(idx, TEMPLATE.replace(/{{SITE}}/g, SITE_NAME).replace(/{{TITLE}}/g, cfg.title).replace(/{{INTRO}}/g, cfg.intro));
  items.forEach(i => latest.push({ ...i, section: cfg.title }));
  console.log(cfg.title + ": " + items.length + " listed");
}
latest.sort((a, b) => b.updated.localeCompare(a.updated));
fs.writeFileSync(path.join(root, "latest.json"), JSON.stringify(latest.slice(0, 8), null, 2));
