/* Shows the tester-application fields only when that type is chosen, and makes them required. */
(function () {
  var sel = document.getElementById("fb-type"), box = document.getElementById("tester-fields");
  if (!sel || !box) return;
  var fields = box.querySelectorAll("input,select"), contact = document.querySelector('[name="contact"]');
  function sync() {
    var on = sel.value === "tester";
    box.style.display = on ? "grid" : "none";
    fields.forEach(function (f) { f.required = on && !f.hasAttribute("data-optional"); });
    if (contact) contact.required = on;
  }
  sel.addEventListener("change", sync); sync();
})();
