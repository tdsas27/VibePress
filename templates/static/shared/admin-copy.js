/* Click a read-only snippet box to select and copy it. */
document.addEventListener("click", function (e) {
  var i = e.target;
  if (i && i.classList && i.classList.contains("snip")) { i.select(); if (navigator.clipboard) navigator.clipboard.writeText(i.value); }
});
/* Buttons with data-copy-target copy the text of that box. */
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-copy-target]"); if (!b) return;
  var t = document.getElementById(b.getAttribute("data-copy-target")); if (!t) return;
  t.select(); if (navigator.clipboard) navigator.clipboard.writeText(t.value); else document.execCommand("copy");
  var o = b.textContent; b.textContent = "Copied!"; setTimeout(function () { b.textContent = o; }, 1500);
});
