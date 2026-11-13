var API = "/x-api/guestbook/data/messages";
var list = document.getElementById("list"), statusEl = document.getElementById("status");   // "status" is a reserved global (window.status); using it here silently breaks
function show(items) {
  list.textContent = "";
  if (!items.length) { list.textContent = "No messages yet. Be the first!"; return; }
  items.forEach(function (m) {
    var li = document.createElement("li"); li.className = "card"; li.style.setProperty("--c", "var(--green)");
    var who = document.createElement("strong"); who.textContent = m.name + (m.mood ? " (" + m.mood + ")" : "");
    var p = document.createElement("p"); p.style.margin = ".3rem 0 0"; p.textContent = m.message;   // textContent: visitor text is never treated as HTML
    li.appendChild(who); li.appendChild(p); list.appendChild(li);
  });
}
function refresh() { fetch(API + "?limit=50").then(function (r) { return r.json(); }).then(function (d) { show(d.items || []); }); }
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target, body = { name: f.name.value, message: f.message.value }; if (f.mood.value) body.mood = f.mood.value;
  fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) { statusEl.textContent = x.ok ? (x.d.pending ? "Thanks! Your message will show once it is approved." : "Thanks!") : (x.d.error || "Something went wrong."); if (x.ok) { f.reset(); refresh(); } });
});
refresh();
