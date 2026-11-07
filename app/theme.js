/* Admin > Theme: generate or hand-pick a color palette (dark or light) and a font, preview it live, save it to brand.json. */
const express = require("express"), UI = require("./ui"), brandfile = require("./brandfile");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const FONTS = {                                   // key: [family, Google Fonts spec ("" = none), label]
    fredoka: ["Fredoka", "Fredoka:wght@400;600;700", "Fredoka (round and friendly, the default)"],
    baloo: ["Baloo 2", "Baloo+2:wght@400;600;700", "Baloo 2 (chunky and playful)"],
    nunito: ["Nunito", "Nunito:wght@400;600;700", "Nunito (soft and easy to read)"],
    quicksand: ["Quicksand", "Quicksand:wght@400;600;700", "Quicksand (light and modern)"],
    comfortaa: ["Comfortaa", "Comfortaa:wght@400;600;700", "Comfortaa (rounded geometric)"],
    poppins: ["Poppins", "Poppins:wght@400;600;700", "Poppins (clean and bold)"],
    inter: ["Inter", "Inter:wght@400;600;700", "Inter (plain and professional)"],
    grotesk: ["Space Grotesk", "Space+Grotesk:wght@400;600;700", "Space Grotesk (techy)"],
    orbitron: ["Orbitron", "Orbitron:wght@400;600;700", "Orbitron (sci-fi)"],
    lora: ["Lora", "Lora:wght@400;600;700", "Lora (serif, bookish)"],
    merriweather: ["Merriweather", "Merriweather:wght@400;700", "Merriweather (serif, sturdy)"],
    righteous: ["Righteous", "Righteous", "Righteous (retro display)"],
    bangers: ["Bangers", "Bangers", "Bangers (comic book)"],
    pacifico: ["Pacifico", "Pacifico", "Pacifico (brush script)"],
    system: ["Trebuchet MS", "", "System font (nothing downloaded, fastest)"]
  };
  const urlOf = k => FONTS[k][1] ? `https://fonts.googleapis.com/css2?family=${FONTS[k][1]}&display=swap` : "";
  const KEYS = ["bg", "card", "ink", "muted", "red", "orange", "yellow", "green", "blue", "purple", "line", "bar", "foot", "onaccent", "glow1", "glow2"];
  const LABELS = { bg: "Page background", card: "Cards and boxes", ink: "Main text", muted: "Soft text", red: "Red accent", orange: "Orange accent", yellow: "Yellow accent", green: "Green accent", blue: "Blue accent (links)", purple: "Purple accent (buttons)",
    line: "Outlines", bar: "Header bar", foot: "Footer", onaccent: "Text on colored buttons", glow1: "Background glow 1", glow2: "Background glow 2" };
  const CLASSIC = { bg: "#110e1f", card: "#1c1833", ink: "#f6f3ff", muted: "#b9b0d9", red: "#ff3b6b", orange: "#ff9f1c", yellow: "#ffe14d", green: "#3ddc84", blue: "#2ec4ff", purple: "#a66bff",
    line: "#3b3463", bar: "#0a0814", foot: "#0a0814", onaccent: "#120d22", glow1: "#2a1747", glow2: "#0f2a4a" };
  const HEX = /^#[0-9a-f]{6}$/i;
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

  const state = () => {
    const b = brandfile.read(), c = Object.assign({}, CLASSIC, b.colors || {}), f = b.font || {};
    let key = Object.keys(FONTS).find(k => FONTS[k][0] === f.family) || "fredoka";
    return { colors: c, scheme: (b.colors || {}).scheme === "light" ? "light" : "dark", font: key, meta: b.theme || null };
  };

  const view = (req, msg, ok, st) => {
    st = st || state();
    const fontOpts = Object.keys(FONTS).map(k => `<option value="${k}" data-family="${esc(FONTS[k][0])}" data-url="${esc(urlOf(k))}"${st.font === k ? " selected" : ""}>${esc(FONTS[k][2])}</option>`).join("");
    const swatches = KEYS.map(k => `<label class="sw"><input type="color" name="c_${k}" id="c_${k}" value="${esc(st.colors[k])}"><span>${esc(LABELS[k])}</span></label>`).join("");
    return page("Theme", `${h1("Theme")}<p><a href="/admin/">&larr; Dashboard</a></p>
${msg ? `<p class="err">${esc(msg)}</p>` : ""}${ok ? `<p class="note" style="margin-top:0">${esc(ok)}</p>` : ""}
<p class="meta">Pick a ready-made look, or generate your own from one color. Everything below can be fine-tuned by hand. Nothing changes on your site until you press <strong>Save theme</strong>.</p>
<form class="wide" method="post" action="/admin/theme/save" id="themeform">${hidden(req)}
<input type="hidden" name="scheme" id="scheme" value="${st.scheme}"><input type="hidden" name="meta" id="meta" value="${esc(JSON.stringify(st.meta || {}))}">
<h3 class="cat">1. Start from a look</h3>
<div class="presets" id="presets"></div>
<h3 class="cat">2. Or generate from one color</h3>
<div class="gen">
<label>Main color<input type="color" id="gbase" value="#a66bff"></label>
<label>Mode<select id="gmode"><option value="dark">Dark</option><option value="light">Light</option></select></label>
<label>Accent colors<select id="gspread"><option value="rainbow">Full rainbow</option><option value="analogous">Shades near the main color</option></select></label>
<label>Strength<select id="gpunch"><option value="soft">Soft</option><option value="bold">Bold</option><option value="neon">Neon</option></select></label>
</div>
<p><button type="button" id="surprise">🎲 Surprise me</button> <span class="meta">Changing a choice above re-creates the colors below.</span></p>
<h3 class="cat">3. Font</h3>
<label>Site font<select name="font" id="font">${fontOpts}</select></label>
<p class="meta">Fonts load from Google Fonts. Choose "System font" if you do not want any outside download.</p>
<h3 class="cat">4. Live preview</h3>
<div id="preview" class="pv"><div class="pvhead"><span class="bubble" style="font-size:1.3rem">Back To Site</span><span class="pvnav"><a href="#" tabindex="-1">Games</a><a href="#" tabindex="-1" aria-current="page">Blog</a></span></div>
<div class="pvbody"><h2 class="bubble" style="font-size:2rem;margin:.2rem 0">Your site name</h2><p style="color:var(--muted)">A sentence of soft text. <a href="#" tabindex="-1">A link</a></p>
<ul class="grid"><li><span class="card" style="--c:var(--red)"><h2>Red card</h2><p>Some text</p></span></li><li><span class="card" style="--c:var(--green)"><h2>Green card</h2><p>Some text</p></span></li><li><span class="card" style="--c:var(--blue)"><h2>Blue card</h2><p>Some text</p></span></li></ul>
<p><span class="btn" style="--c:var(--purple)">A button</span> <span class="btn" style="--c:var(--yellow)">Another</span></p></div>
<div class="pvfoot">Footer area</div></div>
<p id="warn" class="err" role="status"></p>
<details><summary><strong>Fine-tune every color</strong></summary><div class="swatches">${swatches}</div></details>
<p style="margin-top:1.2rem"><button>Save theme</button></p></form>
<div class="row" style="border:0">${brandfile.hasPrev() ? `<form class="inline" method="post" action="/admin/theme/undo">${hidden(req)}<button>↩ Undo the last change</button></form>` : ""}
<form class="inline" method="post" action="/admin/theme/reset">${hidden(req)}<button class="danger" data-confirm="Go back to the original dark VibePress look?">Back to the original look</button></form></div>
<style>.presets{display:flex;flex-wrap:wrap;gap:.6rem}.presets button{display:flex;align-items:center;gap:.5rem;padding:.5rem 1rem}.presets i{display:inline-flex;gap:2px}.presets i b{width:.7rem;height:1.1rem;border-radius:3px;display:block}
.gen{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.9rem;max-width:44rem}.gen input[type=color],.sw input{width:100%;height:2.6rem;padding:.15rem;cursor:pointer}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.9rem;margin:1rem 0}.sw{font-weight:600;font-size:.9rem}
.pv{border:3px solid var(--line);border-radius:1.2rem;overflow:hidden;max-width:44rem;background:var(--bg);color:var(--ink);font-family:var(--font);line-height:1.5}
.pvhead{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;padding:.7rem 1rem;background:var(--bar);border-bottom:3px solid transparent;border-image:var(--rainbow) 1}
.pvnav{display:flex;gap:.4rem}.pvnav a{padding:.2rem .7rem;border-radius:2rem;border:2px solid var(--line);color:var(--ink);text-decoration:none;font-weight:600;font-size:.95rem}.pvnav a[aria-current]{background:var(--card);border-color:var(--purple)}
.pvbody{padding:1rem;background:radial-gradient(circle at 15% 0%,var(--glow1) 0,transparent 45%),radial-gradient(circle at 90% 30%,var(--glow2) 0,transparent 40%),var(--bg)}
.pvbody .card{box-shadow:4px 4px 0 var(--c);height:auto}.pvbody .grid{grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))}.pvbody a{color:var(--blue)}
.pvfoot{padding:.9rem 1rem;background:var(--foot);color:var(--muted);font-size:.9rem}</style>
<script src="/shared/admin-theme.js" defer></script>`, { head: UI });
  };

  const admin = express.Router();
  admin.get("/", (req, res) => res.send(view(req, "", req.query.saved === "1" ? "Theme saved. Your site now uses it (hard-refresh the site to see it)." : req.query.undone === "1" ? "Done. The previous theme is back." : "")));

  admin.post("/save", verifyCsrf, async (req, res) => {
    const b = req.body, colors = {};
    const keep = { colors: Object.assign({}, CLASSIC), scheme: b.scheme === "light" ? "light" : "dark", font: FONTS[b.font] ? b.font : "fredoka", meta: null };
    for (const k of KEYS) { const v = String(b["c_" + k] || "").trim(); if (HEX.test(v)) { colors[k] = v.toLowerCase(); keep.colors[k] = colors[k]; } }
    if (Object.keys(colors).length !== KEYS.length) return res.status(400).send(view(req, "One of the colors was not a valid color. Reload the page and try again.", "", keep));
    let meta = null; try { const m = JSON.parse(String(b.meta || "{}")); if (m && typeof m === "object") meta = { mode: m.mode === "light" ? "light" : "dark", base: HEX.test(m.base) ? m.base : "#a66bff", spread: m.spread === "analogous" ? "analogous" : "rainbow", punch: ["soft", "bold", "neon"].includes(m.punch) ? m.punch : "bold" }; } catch {}
    const f = FONTS[keep.font], br = brandfile.read();
    br.colors = Object.assign(colors, { scheme: keep.scheme });
    br.font = { family: f[0], import: urlOf(keep.font) };
    if (meta) br.theme = meta; else delete br.theme;
    brandfile.write(br);
    const r = await brandfile.render();
    if (!r.ok) { brandfile.undo(); return res.status(500).send(view(req, "The site could not be rebuilt, so nothing was changed. " + r.message, "", keep)); }
    res.redirect("/admin/theme/?saved=1");
  });
  admin.post("/undo", verifyCsrf, async (req, res) => { if (brandfile.undo()) await brandfile.render(); res.redirect("/admin/theme/?undone=1"); });
  admin.post("/reset", verifyCsrf, async (req, res) => {
    const br = brandfile.read(); br.colors = Object.assign({}, CLASSIC, { scheme: "dark" }); br.font = { family: "Fredoka", import: urlOf("fredoka") }; delete br.theme;
    brandfile.write(br); await brandfile.render(); res.redirect("/admin/theme/?saved=1");
  });
  return { admin, ratio };
};
