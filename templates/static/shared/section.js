/* Renders a section's projects.json (written by build-index.js) as cards. */
(async function () {
  const el = document.getElementById("projects");
  if (!el) return;
  const COLORS = ["var(--red)", "var(--orange)", "var(--yellow)", "var(--green)", "var(--blue)", "var(--purple)"];
  const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  try {
    const d = await (await fetch("projects.json", { cache: "no-cache" })).json();
    const h = document.querySelector("main h1");
    if (d.image && h && !document.querySelector(".sec-img")) h.insertAdjacentHTML("beforebegin", '<img class="sec-img" src="' + esc(d.image) + '" alt="" width="140" height="140">');
    if (d.feedTags && d.feedTags.length && !document.querySelector("[data-blog-feed]")) {   // latest posts about this section
      const b = document.createElement("section"); b.setAttribute("data-blog-feed", ""); b.hidden = true;
      b.setAttribute("data-tags", d.feedTags.join(",")); b.setAttribute("data-limit", "3"); b.setAttribute("data-title", "Latest " + d.section + " posts");
      el.parentNode.insertBefore(b, el);
      const s = document.createElement("script"); s.src = "/shared/blog-feed.js"; document.body.appendChild(s);
    }
    if (!d.items.length) { el.innerHTML = '<li class="note">Nothing here yet. New projects appear automatically.</li>'; return; }
    el.innerHTML = d.items.map((p, i) =>
      '<li><a class="card" style="--c:' + esc(p.color || COLORS[i % COLORS.length]) + '" href="' + esc(p.href) + '">' +
      (p.icon ? '<span class="ico">' + esc(p.icon) + '</span>' : '') +
      '<h2>' + esc(p.title) + '</h2><p>' + esc(p.description) + '</p></a></li>').join("");
  } catch (e) {
    el.innerHTML = '<li class="note">The list could not load. Run build-index.js, then refresh.</li>';
  }
})();
