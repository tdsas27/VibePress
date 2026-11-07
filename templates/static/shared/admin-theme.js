/* Admin > Theme: palette generator, presets, live preview, contrast check. */
document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-confirm]"); if (b && !confirm(b.getAttribute("data-confirm"))) e.preventDefault(); });
(function () {
  var form = document.getElementById("themeform"); if (!form) return;
  var KEYS = ["bg", "card", "ink", "muted", "red", "orange", "yellow", "green", "blue", "purple", "line", "bar", "foot", "onaccent", "glow1", "glow2"];
  var $ = function (id) { return document.getElementById(id); }, pv = $("preview");

  /* ---- color math ---- */
  function hsl(h, s, l) { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; var a = s * Math.min(l, 1 - l);
    function f(n) { var k = (n + h / 30) % 12, c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); var x = Math.round(255 * c).toString(16); return x.length < 2 ? "0" + x : x; }
    return "#" + f(0) + f(8) + f(4); }
  function toHsl(hex) { var r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255,
    mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h: h, s: s * 100, l: l * 100 }; }
  function lum(hex) { var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

  /* ---- the generator ---- */
  var RAINBOW = [350, 32, 50, 145, 200, 268], NEAR = [-60, -40, -20, 20, 40, 0];       // red, orange, yellow, green, blue, purple
  function generate(o) {
    var h = toHsl(o.base).h, dark = o.mode === "dark", c = {};
    var sat = { soft: 55, bold: 85, neon: 100 }[o.punch], lt = dark ? { soft: 74, bold: 64, neon: 58 }[o.punch] : { soft: 40, bold: 34, neon: 32 }[o.punch];
    ["red", "orange", "yellow", "green", "blue", "purple"].forEach(function (k, i) {
      var hh = o.spread === "rainbow" ? RAINBOW[i] : h + NEAR[i], hn = ((hh % 360) + 360) % 360, l2 = lt;
      if (!dark && hn > 35 && hn < 170) l2 = lt - 9;            // yellows and greens look washed out on light pages, so go deeper
      if (dark && k === "purple") l2 = lt + 8;                  // keeps button text readable
      c[k] = hsl(hh, sat, l2); });
    if (o.spread === "analogous") c.purple = hsl(h, sat, lt);
    if (dark) { c.bg = hsl(h, 40, 8); c.card = hsl(h, 35, 14); c.ink = hsl(h, 60, 96); c.muted = hsl(h, 25, 75); c.line = hsl(h, 30, 28); c.bar = hsl(h, 45, 6); c.foot = hsl(h, 50, 5);
      c.onaccent = hsl(h, 40, 10); c.glow1 = hsl(h + 15, 55, 17); c.glow2 = hsl(h - 45, 65, 17); }
    else { c.bg = hsl(h, 40, 96); c.card = hsl(h, 40, 99); c.ink = hsl(h, 35, 13); c.muted = hsl(h, 15, 36); c.line = hsl(h, 25, 78); c.bar = hsl(h, 40, 98); c.foot = hsl(h, 35, 92);
      c.onaccent = "#ffffff"; c.glow1 = hsl(h + 15, 70, 91); c.glow2 = hsl(h - 45, 70, 91); }
    return c;
  }
  var CLASSIC = { bg: "#110e1f", card: "#1c1833", ink: "#f6f3ff", muted: "#b9b0d9", red: "#ff3b6b", orange: "#ff9f1c", yellow: "#ffe14d", green: "#3ddc84", blue: "#2ec4ff", purple: "#a66bff",
    line: "#3b3463", bar: "#0a0814", foot: "#0a0814", onaccent: "#120d22", glow1: "#2a1747", glow2: "#0f2a4a" };
  var PRESETS = [
    { name: "Classic Night", colors: CLASSIC, mode: "dark", font: "fredoka" },
    { name: "Ocean", mode: "dark", base: "#1f8fff", spread: "analogous", punch: "bold", font: "nunito" },
    { name: "Sunset", mode: "dark", base: "#ff6a3d", spread: "analogous", punch: "bold", font: "poppins" },
    { name: "Forest", mode: "dark", base: "#2ecc71", spread: "analogous", punch: "soft", font: "lora" },
    { name: "Neon Arcade", mode: "dark", base: "#00e5c0", spread: "rainbow", punch: "neon", font: "orbitron" },
    { name: "Daylight", mode: "light", base: "#4f6bff", spread: "rainbow", punch: "bold", font: "nunito" },
    { name: "Candy", mode: "light", base: "#ff4fa3", spread: "rainbow", punch: "soft", font: "baloo" },
    { name: "Paper", mode: "light", base: "#8a6d3b", spread: "analogous", punch: "soft", font: "merriweather" }
  ];

  /* ---- applying to the form and the preview ---- */
  var loaded = {};
  function loadFont() { var s = $("font"), o = s.options[s.selectedIndex]; if (!o) return;
    var u = o.getAttribute("data-url"); if (u && !loaded[u]) { loaded[u] = 1; var l = document.createElement("link"); l.rel = "stylesheet"; l.href = u; document.head.appendChild(l); }
    pv.style.setProperty("--font", '"' + o.getAttribute("data-family") + '","Trebuchet MS",system-ui,sans-serif'); }
  function refresh() {
    KEYS.forEach(function (k) { pv.style.setProperty("--" + k, $("c_" + k).value); });
    pv.style.setProperty("--rainbow", "linear-gradient(90deg,var(--red),var(--orange),var(--yellow),var(--green),var(--blue),var(--purple),var(--red))");
    var m = { mode: $("gmode").value, base: $("gbase").value, spread: $("gspread").value, punch: $("gpunch").value };
    $("scheme").value = m.mode; $("meta").value = JSON.stringify(m); pv.style.colorScheme = m.mode;
    var w = [], bg = $("c_bg").value;
    [["ink", "Main text", 4.5], ["muted", "Soft text", 3.5], ["blue", "Links", 3]].forEach(function (t) { var r = ratio($("c_" + t[0]).value, bg); if (r < t[2]) w.push(t[1] + " is hard to read on the page background (contrast " + r.toFixed(1) + ", aim for " + t[2] + "+)."); });
    $("warn").textContent = w.join(" ");
  }
  function setColors(c) { KEYS.forEach(function (k) { if (c[k]) $("c_" + k).value = c[k]; }); refresh(); }
  function regen() { setColors(generate({ base: $("gbase").value, mode: $("gmode").value, spread: $("gspread").value, punch: $("gpunch").value })); }
  function setFont(k) { var s = $("font"); for (var i = 0; i < s.options.length; i++) if (s.options[i].value === k) s.selectedIndex = i; loadFont(); }

  var box = $("presets");
  PRESETS.forEach(function (p) {
    var b = document.createElement("button"); b.type = "button";
    var c = p.colors || generate(p), sw = document.createElement("i");
    ["bg", "red", "yellow", "green", "blue", "purple"].forEach(function (k) { var s = document.createElement("b"); s.style.background = c[k]; sw.appendChild(s); });
    b.appendChild(sw); b.appendChild(document.createTextNode(p.name));
    b.addEventListener("click", function () {
      $("gmode").value = p.mode; if (p.base) $("gbase").value = p.base; if (p.spread) $("gspread").value = p.spread; if (p.punch) $("gpunch").value = p.punch;
      setFont(p.font); if (p.colors) setColors(p.colors); else regen(); });
    box.appendChild(b);
  });
  ["gbase", "gmode", "gspread", "gpunch"].forEach(function (id) { $(id).addEventListener("input", regen); $(id).addEventListener("change", regen); });
  KEYS.forEach(function (k) { $("c_" + k).addEventListener("input", refresh); });
  $("font").addEventListener("change", loadFont);
  $("surprise").addEventListener("click", function () {
    var r = function (a) { return a[Math.floor(Math.random() * a.length)]; }, s = $("font");
    $("gbase").value = hsl(Math.random() * 360, 75, 55); $("gmode").value = r(["dark", "dark", "light"]); $("gspread").value = r(["rainbow", "analogous"]); $("gpunch").value = r(["soft", "bold", "neon"]);
    s.selectedIndex = Math.floor(Math.random() * s.options.length); loadFont(); regen(); });

  /* start from whatever is saved */
  var meta = {}; try { meta = JSON.parse($("meta").value || "{}"); } catch (e) {}
  $("gmode").value = meta.mode || $("scheme").value || "dark"; if (meta.base) $("gbase").value = meta.base; if (meta.spread) $("gspread").value = meta.spread; if (meta.punch) $("gpunch").value = meta.punch;
  loadFont(); refresh();
})();
