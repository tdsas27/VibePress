// The shop page. All text from the server is shown with textContent (never innerHTML).
(function () {
  var BASE = "/x-api/crypto-downloads/r/", CODE = /^[a-f0-9]{24}$/;
  var msg = document.getElementById("msg"), list = document.getElementById("products"), box = document.getElementById("order");
  var timer = null, tick = null;

  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === "text") e.textContent = props[k]; else if (k === "style") e.setAttribute("style", props[k]); else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function api(path, opts) {
    return fetch(BASE + path, opts).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }
  function say(text, bad) { msg.textContent = text || ""; msg.className = bad ? "err" : ""; }
  function size(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB"; }
  function clock(ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }
  function copy(text, button) {
    function done(ok) { var old = button.textContent; button.textContent = ok ? "Copied" : "Select and copy it by hand"; setTimeout(function () { button.textContent = old; }, 1800); }
    function fallback() {
      var t = el("textarea", { style: "position:fixed;opacity:0" }); t.value = text; document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} document.body.removeChild(t); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback); else fallback();
  }
  function copyBtn(text) {
    var b = el("button", { type: "button", class: "btn", style: "--c:var(--blue);padding:.3rem .8rem", text: "Copy" });
    b.addEventListener("click", function () { copy(text, b); });
    return b;
  }
  function copyRow(text) { return el("div", { class: "row2" }, [el("code", { text: text, style: "flex:1;margin:0" }), copyBtn(text)]); }
  function stop() { if (timer) clearInterval(timer); if (tick) clearInterval(tick); timer = tick = null; }

  // ---------- catalog ----------
  function showCatalog() {
    stop(); box.hidden = true; list.hidden = false; say("");
    api("catalog").then(function (r) {
      if (!r.ok) { say("The shop has a technical problem" + (r.d && r.d.error ? " (" + r.d.error + ")" : " (error " + r.status + ")") + ". Please try again later. If you own this site, open Admin > Plugins > Crypto Downloads > Status.", true); return; }
      if (!r.d.configured) { say("This shop is not open yet. Please check back soon."); return; }
      list.textContent = "";
      r.d.products.forEach(function (p, i) {
        var btns = el("div", { class: "coinbtns" });
        Object.keys(p.prices).forEach(function (c) {
          var b = el("button", { type: "button", class: "btn", style: "--c:var(--" + ["purple", "green", "blue"][["btc", "eth", "ton"].indexOf(c)] + ")", text: p.prices[c] + " " + r.d.coins[c].symbol + " (" + r.d.coins[c].name + ")" });
          b.addEventListener("click", function () { startOrder(p.id, c, b); });
          btns.appendChild(b);
        });
        list.appendChild(el("li", {}, [el("div", { class: "card", style: "--c:var(--" + ["red", "orange", "yellow", "green", "blue", "purple"][i % 6] + ")" }, [
          el("h2", { text: p.title }), p.description ? el("p", { text: p.description }) : null,
          el("p", { class: "shop-note", style: "font-size:.9rem", text: p.file.name + " \u00b7 " + size(p.file.size) + " \u00b7 SHA-256 " + p.file.sha256.slice(0, 16) + "\u2026" }), btns]) ]));
      });
    }, function () { say("The shop could not be reached. Please try again.", true); });
  }
  function startOrder(product, coin, button) {
    button.disabled = true; say("Creating your order\u2026");
    api("order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: product, coin: coin }) }).then(function (r) {
      button.disabled = false;
      if (!r.ok) { say(r.d.error || "Could not start the order.", true); return; }
      say(""); current = r.d.code; location.hash = "order=" + r.d.code; showOrder(r.d); poll(r.d.code);
    }, function () { button.disabled = false; say("Could not reach the shop. Please try again.", true); });
  }

  // ---------- one order ----------
  function showOrder(o) {
    list.hidden = true; box.hidden = false; box.textContent = "";
    var back = el("p", {}, [el("a", { href: "#", text: "\u2190 Back to the shop" })]);
    back.firstChild.addEventListener("click", function (e) { e.preventDefault(); current = null; location.hash = ""; showCatalog(); });
    box.appendChild(el("h2", { text: o.title }));

    if (o.paid) { stop(); return showPaid(o); }
    if (o.status === "expired") {
      stop();
      box.appendChild(el("p", { class: "warn", text: "This order has expired. If you already sent a payment, keep this page's address and give the shop owner this order code: " + o.code }));
      box.appendChild(back); return;
    }
    var late = Date.now() > o.expiresAt;
    box.appendChild(el("p", {}, ["Send exactly"]));
    box.appendChild(el("div", { class: "row2" }, [el("span", { class: "big", text: o.amount + " " + o.symbol }), copyBtn(o.amount)]));
    box.appendChild(el("p", {}, ["to this " + o.name + " address:"]));
    box.appendChild(copyRow(o.address));
    if (o.memo) {
      box.appendChild(el("p", { class: "warn", text: "Important: add this comment (memo) to your payment, exactly as written. Without it we cannot match your payment:" }));
      box.appendChild(copyRow(o.memo));
    } else {
      box.appendChild(el("p", { class: "warn", text: "Send the exact amount above, including the last digits; they identify your order. If your wallet or exchange takes its fee out of the amount, add the fee on top so the full amount arrives." }));
    }
    var qr = el("div", { class: "qrbox" }), cv = el("canvas", { "aria-label": "QR code with the payment details" }); qr.appendChild(cv); box.appendChild(qr);
    try { window.QR.draw(cv, o.uri, 5); } catch (e) { qr.hidden = true; }
    box.appendChild(el("p", {}, [el("a", { href: o.uri, text: "Open in my wallet app" })]));
    var clockEl = el("p", { class: "shop-note" }), state = el("p", { id: "state", role: "status", text: "Waiting for your payment. This page checks by itself every few seconds." });
    box.appendChild(clockEl); box.appendChild(state);
    if (o.needConfirmations) box.appendChild(el("p", { class: "shop-note", text: "Your download unlocks after " + o.needConfirmations + " network confirmation" + (o.needConfirmations > 1 ? "s" : "") + ", which can take a while." }));
    box.appendChild(el("p", { class: "shop-note", text: "Your order is saved in this page's address: bookmark it to come back. Order code: " + o.code }));
    box.appendChild(back);
    function paint() {
      var left = o.expiresAt - Date.now();
      clockEl.textContent = left > 0 ? "Please pay within " + clock(left) + "." : "The payment window has ended, but payments sent in time are still matched for up to 3 hours. If you already paid, just wait here.";
    }
    paint(); if (tick) clearInterval(tick); tick = setInterval(paint, 1000);
  }
  function showPaid(o) {
    box.appendChild(el("p", { class: "ok", text: "Payment received. Thank you!" }));
    var out = el("div"), b = el("button", { type: "button", class: "btn", style: "--c:var(--green);font-size:1.2rem", text: "Download" });
    b.addEventListener("click", function () {
      b.disabled = true; out.textContent = "";
      api("claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: o.code }) }).then(function (r) {
        b.disabled = false;
        if (!r.ok) { out.appendChild(el("p", { class: "err", text: r.d.error || "The download could not start." })); return; }
        out.appendChild(el("p", {}, ["Your download is starting: " + r.d.name + " (" + size(r.d.size) + "). If nothing happens, ", el("a", { href: r.d.url, text: "click here" }), "."]));
        out.appendChild(el("p", { class: "shop-note", text: "SHA-256: " + r.d.sha256 + " (you can use this to check the file arrived intact). Downloads left for this purchase: " + r.d.claimsLeft + "." }));
        location.href = r.d.url;
      }, function () { b.disabled = false; out.appendChild(el("p", { class: "err", text: "Could not reach the shop. Please try again." })); });
    });
    box.appendChild(b); box.appendChild(out);
    box.appendChild(el("p", { class: "shop-note", text: "Downloads left: " + o.claimsLeft + ". This page stays valid until " + new Date(o.accessUntil).toLocaleDateString() + ". Bookmark it. Order code: " + o.code }));
  }
  function poll(code) {
    if (timer) clearInterval(timer);
    function once() {
      api("status?code=" + code).then(function (r) {
        if (!r.ok) { if (r.status === 404) { stop(); current = null; location.hash = ""; showCatalog(); say("That order was not found.", true); } return; }
        var o = r.d;
        if (o.paid || o.status === "expired") { showOrder(o); return; }
        var s = document.getElementById("state"); if (s) s.textContent = "Waiting for your payment. Last checked " + new Date().toLocaleTimeString() + ".";
      }, function () { /* try again on the next tick */ });
    }
    timer = setInterval(once, 10000); once();
  }

  // ---------- start, and follow the address (back button, bookmarks) ----------
  var current = null;
  function route() {
    var m = /^#order=([a-f0-9]{24})$/.exec(location.hash);
    if (!m) { if (current !== null || !box.hidden) { current = null; showCatalog(); } return; }
    if (current === m[1] && !box.hidden) return;
    current = m[1]; stop(); list.hidden = true; say("Loading your order\u2026");
    api("status?code=" + m[1]).then(function (r) {
      if (current !== m[1]) return;
      if (!r.ok) { current = null; say(r.d.error || "That order was not found.", true); showCatalog(); return; }
      say(""); showOrder(r.d); if (!r.d.paid && r.d.status !== "expired") poll(m[1]);
    }, function () { say("The shop could not be reached. Please reload.", true); });
  }
  window.addEventListener("hashchange", route);
  if (/^#order=[a-f0-9]{24}$/.test(location.hash)) route(); else showCatalog();
})();
