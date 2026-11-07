/* Click guard for buttons with data-confirm (inline handlers are blocked by the site's security policy). */
document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-confirm]"); if (b && !confirm(b.getAttribute("data-confirm"))) e.preventDefault(); });
/* Admin > Menu editor: rows with up / down / remove, add a page, add a custom link. */
(function () {
  var list = document.getElementById("mlist"); if (!list) return;
  var max = +list.getAttribute("data-max") || 12, items = [];
  try { items = JSON.parse(list.getAttribute("data-items") || "[]"); } catch (e) {}
  function btn(act, text, label) { var b = document.createElement("button"); b.type = "button"; b.setAttribute("data-act", act); b.textContent = text; b.setAttribute("aria-label", label); return b; }
  function row(label, href) {
    var li = document.createElement("li"); li.className = "mrow";
    var a = document.createElement("input"); a.name = "label"; a.maxLength = 40; a.placeholder = "Label"; a.value = label || ""; a.setAttribute("aria-label", "Label");
    var h = document.createElement("input"); h.name = "href"; h.className = "mh"; h.maxLength = 300; h.placeholder = "/page/ or https://..."; h.value = href || ""; h.setAttribute("aria-label", "Address");
    li.appendChild(a); li.appendChild(h); li.appendChild(btn("up", "\u2191", "Move up")); li.appendChild(btn("down", "\u2193", "Move down")); li.appendChild(btn("del", "\u2715", "Remove"));
    return li;
  }
  items.forEach(function (i) { list.appendChild(row(i.label, i.href)); });
  function room() { if (list.children.length >= max) { alert("The menu can hold " + max + " links."); return false; } return true; }
  list.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var li = b.parentNode, act = b.getAttribute("data-act");
    if (act === "del") li.remove();
    else if (act === "up" && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
    else if (act === "down" && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
  });
  document.getElementById("madd").addEventListener("click", function () {
    var s = document.getElementById("mpick"), o = s.options[s.selectedIndex]; if (!o || !room()) return;
    list.appendChild(row(o.text.replace(/\s*\([^)]*\)\s*$/, ""), o.value));
  });
  document.getElementById("mblank").addEventListener("click", function () { if (!room()) return; var r = row("", ""); list.appendChild(r); r.firstChild.focus(); });
})();
