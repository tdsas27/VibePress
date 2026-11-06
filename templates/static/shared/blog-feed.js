/* Shows the latest blog posts (title, date, a short teaser and a small thumbnail). Put <section data-blog-feed data-tags="games,game" data-limit="3" hidden></section> where you want them. */
(function () {
  function fmt(d) { try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return ""; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function render(box) {
    var tags = box.getAttribute("data-tags") || "", limit = box.getAttribute("data-limit") || "3";
    fetch("/blog/recent.json?limit=" + encodeURIComponent(limit) + (tags ? "&tags=" + encodeURIComponent(tags) : ""))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (posts) {
        if (!posts.length) { box.hidden = true; return; }
        box.textContent = ""; box.className = "bp-feed"; box.hidden = false;
        var head = el("h2", "bp-head", box.getAttribute("data-title") || "Latest from the blog"), all = el("a", "bp-all", "All posts \u2192"); all.href = "/blog/"; head.appendChild(all); box.appendChild(head);
        var list = el("div", "bp-list");
        posts.forEach(function (p) {
          var a = el("a", "bp-card"); a.href = p.url;
          if (p.thumb) { var im = el("img", "bp-thumb"); im.src = p.thumb; im.alt = ""; im.loading = "lazy"; im.width = 96; im.height = 96; a.appendChild(im); }
          var body = el("div", "bp-body"); body.appendChild(el("h3", "", p.title)); body.appendChild(el("p", "bp-date", fmt(p.date)));
          if (p.excerpt) body.appendChild(el("p", "bp-ex", p.excerpt)); body.appendChild(el("span", "bp-more", "Read more \u2192"));
          a.appendChild(body); list.appendChild(a);
        });
        box.appendChild(list);
      }).catch(function () { box.hidden = true; });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-blog-feed]"), render);
})();
