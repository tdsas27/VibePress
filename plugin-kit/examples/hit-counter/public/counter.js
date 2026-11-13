fetch("/x-api/hit-counter/r/hit", { method: "POST" })
  .then(function (r) { return r.json(); })
  .then(function (d) { document.getElementById("n").textContent = String(d.hits).padStart(6, "0"); })
  .catch(function () { document.getElementById("n").textContent = "??????"; });
