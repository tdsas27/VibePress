document.getElementById("go").addEventListener("click", function () {
  document.getElementById("out").textContent = "Hi! It is " + new Date().toLocaleTimeString() + ".";
});
