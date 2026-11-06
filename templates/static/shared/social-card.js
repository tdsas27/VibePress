/* Draws a share card image in the browser (canvas) and downloads it as a PNG. Used by the admin Social posts page. */
(function () {
  var $ = function (i) { return document.getElementById(i); }, cv = $("sc-canvas");
  if (!cv) return;
  var cols = ["#ff3b6b", "#ff9f1c", "#ffe14d", "#3ddc84", "#2ec4ff", "#a66bff"], brand = ($("sc-sub") && $("sc-sub").placeholder) || "";
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line); return lines;
  }
  function draw() {
    var s = $("sc-size").value.split("x"), W = +s[0], H = +s[1], ctx = cv.getContext("2d"), wide = W > H;
    cv.width = W; cv.height = H;
    ctx.fillStyle = "#110e1f"; ctx.fillRect(0, 0, W, H);
    var bar = Math.round(H * 0.03); cols.forEach(function (c, i) { ctx.fillStyle = c; ctx.fillRect(i * W / 6, 0, W / 6 + 1, bar); ctx.fillRect(i * W / 6, H - bar, W / 6 + 1, bar); });
    var img = new Image();
    img.onload = function () {
      var art = wide ? Math.round(H * 0.62) : Math.round(W * 0.5), ax = wide ? Math.round(W * 0.06) : Math.round((W - art) / 2), ay = wide ? Math.round((H - art) / 2) : Math.round(H * 0.07);
      ctx.drawImage(img, ax, ay, art, art);
      var tx = wide ? ax + art + Math.round(W * 0.05) : Math.round(W * 0.08), tw = wide ? W - tx - Math.round(W * 0.06) : W - 2 * tx, ty = wide ? Math.round(H * 0.2) : ay + art + Math.round(H * 0.05);
      var maxH = wide ? Math.round(H * 0.5) : Math.round(H * 0.3), size = wide ? 84 : 96, title = $("sc-title").value || brand, lines;
      do { ctx.font = "700 " + size + 'px Fredoka, "Trebuchet MS", sans-serif'; lines = wrap(ctx, title, tw); size -= 4; }
      while ((lines.length * (size + 4) * 1.12 > maxH || lines.some(function (l) { return ctx.measureText(l).width > tw; })) && size > 28);
      var g = ctx.createLinearGradient(tx, 0, tx + tw, 0); cols.forEach(function (c, i) { g.addColorStop(i / 5, c); });
      ctx.fillStyle = g; ctx.textBaseline = "top"; var lh = (size + 4) * 1.12;
      lines.forEach(function (l, i) { ctx.fillText(l, tx, ty + i * lh); });
      ctx.font = "600 " + Math.round(size * 0.45) + 'px Fredoka, "Trebuchet MS", sans-serif'; ctx.fillStyle = "#b9b0d9";
      ctx.fillText($("sc-sub").value || brand, tx, ty + lines.length * lh + Math.round(size * 0.25));
    };
    img.src = $("sc-art").value;
  }
  ["sc-size", "sc-art", "sc-title", "sc-sub"].forEach(function (id) { $(id).addEventListener("input", draw); $(id).addEventListener("change", draw); });
  $("sc-dl").addEventListener("click", function () { cv.toBlob(function (b) { var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "share-card.png"; a.click(); }); });
  (document.fonts && document.fonts.load ? document.fonts.load('700 40px Fredoka') : Promise.resolve()).then(draw, draw);
})();
