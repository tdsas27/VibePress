// Crypto Downloads: server side. Runs in the VibePress plugin sandbox.
//
// How a payment is recognised (no keys, no custody, nothing leaves your wallets):
//   Bitcoin / Ethereum: the buyer is asked for an exact amount = price + a tiny unique extra (a few satoshi / gwei). No two open
//                       orders for the same coin share an amount, so the amount identifies the order.
//   TON:                the buyer includes a short reference (comment) with the payment; the amount must be at least the price.
// A payment only counts when it is on the blockchain with enough confirmations, arrived in time, is not already used for another
// order, and the file is released through a short-lived link (vp.files.grant). The owner can always mark an order paid by hand.
const crypto = require("crypto");
const units = require("./lib/units");
const providersLib = require("./lib/providers");

const GRACE = 3 * 3600 * 1000;                      // payments up to 3 hours after the order window are still matched
const COINS = {
  btc: { name: "Bitcoin", sym: "BTC", dec: 8, tags: 300, tagUnit: 1n, window: 1n },
  eth: { name: "Ethereum", sym: "ETH", dec: 18, tags: 9999, tagUnit: 1000000000n, window: 1000000000n },
  ton: { name: "TON", sym: "TON", dec: 9, tags: 0, tagUnit: 0n, window: 0n }
};
const HEX24 = /^[a-f0-9]{24}$/, PID = /^[a-f0-9]{10}$/;
const MEMO_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

module.exports = function (vp) {
  const provider = providersLib.make(vp);
  const fail = function (status, message) { return { status: status, json: { error: message } }; };

  async function loadCfg() {
    const s = await vp.settings.get(), v = s.values || {}, files = await vp.files.list();
    const fileMap = {}; files.forEach(function (f) { fileMap[f.id] = f; });
    const coins = {};
    Object.keys(COINS).forEach(function (c) { if (v[c + "_address"]) coins[c] = v[c + "_address"]; });
    const products = [];
    ((s.lists || {}).products || []).forEach(function (p) {
      if (!p.file || !fileMap[p.file]) return;
      const prices = {};
      Object.keys(coins).forEach(function (c) {
        if (!p[c]) return;
        try { const u = units.toUnits(p[c], COINS[c].dec); if (u > 0n) prices[c] = { text: p[c], units: u.toString() }; } catch (e) { /* too many decimals for this coin: not offered */ }
      });
      if (Object.keys(prices).length) products.push({ id: p.id, title: p.title, description: p.description || "", file: fileMap[p.file], prices: prices });
    });
    return { coins: coins, products: products, fileMap: fileMap, orderMs: (v.order_minutes || 60) * 60000, maxDownloads: v.max_downloads || 5, accessMs: (v.access_days || 30) * 86400000,
      need: { btc: v.btc_confirmations || 1, eth: v.eth_confirmations || 12, ton: 0 } };
  }

  const art = function (w) { return /^[AEIOU]/.test(w) ? "an " : "a "; };   // "a Bitcoin", "an Ethereum"
  // ---------- setup check for the owner (only the admin screens can call routes that start with __) ----------
  vp.route("GET", "/__status", async function () {
    const s = await vp.settings.get(), v = s.values || {}, files = await vp.files.list(), prods = (s.lists || {}).products || [], items = [], fileIds = {};
    files.forEach(function (f) { fileIds[f.id] = f; });
    const add = function (ok, text, fix) { items.push({ ok: ok, text: text, fix: fix || "" }); };
    add(files.length > 0, files.length ? files.length + " file" + (files.length > 1 ? "s" : "") + " uploaded" : "No files uploaded yet", "Open Files on this plugin's card and upload what you want to sell.");
    const have = Object.keys(COINS).filter(function (c) { return !!v[c + "_address"]; });
    add(have.length > 0, have.length ? "Accepting " + have.map(function (c) { return COINS[c].name; }).join(", ") : "No wallet address entered", "Open Settings and enter at least one address: Bitcoin, Ethereum or TON.");
    add(prods.length > 0, prods.length ? prods.length + " product" + (prods.length > 1 ? "s" : "") + " in Settings" : "No products in Settings yet", "In Settings, fill in the empty box under Products (title, file, a price) and press Save settings.");
    let onSale = 0;
    prods.forEach(function (p) {
      const name = '"' + (p.title || "(no title)") + '"', why = [], sells = [], ignored = [];
      if (!p.file) why.push("no file chosen"); else if (!fileIds[p.file]) why.push("its file was deleted: upload it again and choose it");
      let anyPrice = false;
      Object.keys(COINS).forEach(function (c) {
        if (!p[c]) return; anyPrice = true;
        if (!v[c + "_address"]) { ignored.push("it has " + art(COINS[c].sym) + COINS[c].sym + " price but you have not entered " + art(COINS[c].name) + COINS[c].name + " address"); return; }
        try { if (units.toUnits(p[c], COINS[c].dec) <= 0n) why.push("its " + COINS[c].sym + " price is zero"); else sells.push(COINS[c].sym + " " + p[c]); } catch (e) { why.push("its " + COINS[c].sym + " price has too many decimal places for " + COINS[c].name); }
      });
      if (!anyPrice) why.push("it has no price in any coin");
      if (sells.length && !why.filter(function (w) { return /file/.test(w); }).length) {
        onSale++; add(true, name + " is on sale for " + sells.join(", "));
        if (ignored.length) add(false, name + " has prices that are ignored: " + ignored.join("; "), "Enter that address in Settings, or clear that price.");
      } else add(false, name + " is not on sale: " + why.concat(ignored).join("; "), "Fix this in Settings > Products, then Save settings.");
    });
    add(onSale > 0, onSale > 0 ? "The shop is open with " + onSale + " product" + (onSale > 1 ? "s" : "") : "The shop is NOT open yet: no product can be sold", "A product needs a file and a price in a coin whose address you entered.");
    const orders = await vp.data.list("orders", { limit: 200 }), paid = orders.filter(function (o) { return o.approved; }).length;
    add(true, orders.length + " order" + (orders.length === 1 ? "" : "s") + " so far, " + paid + " paid");
    return { json: { items: items } };
  });

  // ---------- catalog ----------
  vp.route("GET", "/catalog", async function () {
    const cfg = await loadCfg();
    return { json: {
      configured: cfg.products.length > 0,
      coins: Object.keys(cfg.coins).reduce(function (o, c) { o[c] = { name: COINS[c].name, symbol: COINS[c].sym }; return o; }, {}),
      products: cfg.products.map(function (p) {
        return { id: p.id, title: p.title, description: p.description, file: { name: p.file.name, size: p.file.size, sha256: p.file.sha256 },
          prices: Object.keys(p.prices).reduce(function (o, c) { o[c] = p.prices[c].text; return o; }, {}) };
      })
    } };
  });

  // ---------- create an order ----------
  async function allowedNow(visitor) {                       // at most 3 new orders per visitor per 10 minutes
    const rl = (await vp.kv.get("rl")) || {}, t = Date.now(), mine = (rl[visitor] || []).filter(function (x) { return t - x < 600000; });
    if (mine.length >= 3) return false;
    mine.push(t); rl[visitor] = mine;
    const keys = Object.keys(rl);
    if (keys.length > 300) keys.forEach(function (k) { rl[k] = rl[k].filter(function (x) { return t - x < 600000; }); if (!rl[k].length) delete rl[k]; });
    await vp.kv.set("rl", rl); return true;
  }
  vp.route("POST", "/order", async function (req) {
    const b = req.body || {}, coin = String(b.coin || ""), pid = String(b.product || "");
    if (!COINS[coin] || !PID.test(pid)) return fail(400, "Choose a product and a coin.");
    const cfg = await loadCfg(), product = cfg.products.filter(function (p) { return p.id === pid; })[0];
    if (!product || !product.prices[coin]) return fail(400, "That product is not available for " + COINS[coin].name + ".");
    if (!(await allowedNow(req.visitor))) return fail(429, "Please wait a few minutes before starting another order.");

    const t = Date.now(), c = COINS[coin], base = BigInt(product.prices[coin].units);
    const open = (await vp.data.list("orders", { approved: false, limit: 200 })).filter(function (o) { return o.status === "pending" && o.exp + GRACE > t && o.coin === coin; });
    if (open.length >= 150) return fail(503, "The shop is very busy. Please try again in a little while.");
    let final = base;
    if (c.tags) {
      final = null;
      for (let i = 0; i < 80 && final === null; i++) {
        const cand = base + BigInt(1 + crypto.randomInt(c.tags)) * c.tagUnit;
        if (!open.some(function (o) { return units.abs(BigInt(o.units) - cand) < c.window; })) final = cand;
      }
      if (final === null) return fail(503, "The shop is very busy. Please try again in a little while.");
    }
    let memo = "CD"; for (let i = 0; i < 6; i++) memo += MEMO_CHARS[crypto.randomInt(MEMO_CHARS.length)];
    const o = await vp.data.add("orders", {
      code: crypto.randomBytes(12).toString("hex"), memo: memo, product: product.id, title: product.title, file: product.file.id, coin: coin, address: cfg.coins[coin],
      amount: units.fromUnits(final, c.dec), units: final.toString(), exp: t + cfg.orderMs, status: "pending", claims: 0, checked: 0
    }, { approved: false });
    return { json: view(o, cfg) };
  });

  function uri(o) {
    if (o.coin === "btc") return "bitcoin:" + o.address + "?amount=" + o.amount;
    if (o.coin === "eth") return "ethereum:" + o.address + "@1?value=" + o.units;
    return "ton://transfer/" + o.address + "?amount=" + o.units + "&text=" + o.memo;
  }
  function view(o, cfg) {
    const paid = o.approved === true, t = Date.now(), paidAt = o.paidat || Date.parse(o.at);
    return { code: o.code, paid: paid, status: paid ? "paid" : (o.status === "pending" && t > o.exp + GRACE ? "expired" : o.status), title: o.title, coin: o.coin, name: COINS[o.coin].name, symbol: COINS[o.coin].sym,
      amount: o.amount, address: o.address, memo: o.coin === "ton" ? o.memo : undefined, uri: uri(o), expiresAt: o.exp, graceUntil: o.exp + GRACE,
      needConfirmations: o.coin === "ton" ? 0 : cfg.need[o.coin], claimsLeft: Math.max(0, cfg.maxDownloads - (o.claims || 0)), accessUntil: paidAt + cfg.accessMs };
  }

  // ---------- looking for the payment ----------
  async function recent(coin, address, cfg, deadline) {
    const key = "c:" + coin, cached = await vp.kv.get(key), t = Date.now();
    if (cached && cached.addr === address && t - cached.at < 15000) return cached.txs;
    const lock = await vp.kv.get("l:" + coin);
    if (cached && cached.addr === address && lock && t - lock < 6000) return cached.txs;          // someone else is already looking
    await vp.kv.set("l:" + coin, t);
    try {
      const txs = await provider[coin](address, { left: function () { return deadline - Date.now(); }, confsNeeded: cfg.need[coin] });
      await vp.kv.set(key, { at: Date.now(), addr: address, txs: txs }); return txs;
    } catch (e) {
      vp.log(coin + " lookup failed: " + String(e.message).slice(0, 120));
      if (cached && cached.addr === address && t - cached.at < 300000) return cached.txs;
      throw e;
    }
  }
  async function findPayment(o, cfg, deadline) {
    const c = COINS[o.coin], txs = await recent(o.coin, o.address, cfg, deadline), expected = BigInt(o.units), created = Date.parse(o.at);
    for (const t of txs) {
      if (!t.ok) continue;
      const got = BigInt(t.units);
      if (o.coin === "ton") { if (t.comment !== o.memo || got < expected) continue; }
      else if (got < expected || got >= expected + c.window) continue;
      if (t.time !== null && (t.time < created - 7200000 || t.time > o.exp + GRACE)) continue;   // before the order existed, or far too late
      if (o.coin !== "ton" && (t.confs === null || t.confs < cfg.need[o.coin])) continue;            // not final enough yet
      const other = await vp.data.find("orders", "txid", t.id);
      if (other && other.id !== o.id) continue;                                                      // that payment already belongs to another order
      return t;
    }
    return null;
  }

  vp.route("GET", "/status", async function (req) {
    const started = Date.now(), code = String(req.query.code || "");
    if (!HEX24.test(code)) return fail(400, "That order code does not look right.");
    let o = await vp.data.find("orders", "code", code);
    if (!o) return fail(404, "Order not found.");
    const cfg = await loadCfg(), t = Date.now();
    if (!o.approved && o.status === "pending") {
      if (t > o.exp + GRACE) o = await vp.data.update("orders", o.id, { status: "expired" });
      else if (t - (o.checked || 0) >= 8000) {
        o = await vp.data.update("orders", o.id, { checked: t });
        try {
          const hit = await findPayment(o, cfg, started + 8500);
          if (hit) { o = await vp.data.update("orders", o.id, { txid: hit.id, status: "paid", paidat: Date.now() }); o = await vp.data.approve("orders", o.id, true); }
        } catch (e) { vp.log("payment check failed: " + String(e.message).slice(0, 150)); }          // retried on the next check
      }
    }
    if (o.approved && o.status !== "paid") o = await vp.data.update("orders", o.id, { status: "paid", paidat: o.paidat || Date.now() });
    return { json: view(o, cfg) };
  });

  // ---------- hand over the file ----------
  vp.route("POST", "/claim", async function (req) {
    const code = String((req.body || {}).code || "");
    if (!HEX24.test(code)) return fail(400, "That order code does not look right.");
    const o = await vp.data.find("orders", "code", code);
    if (!o || o.approved !== true) return fail(402, "This order has not been paid yet.");
    const cfg = await loadCfg(), t = Date.now(), paidAt = o.paidat || Date.parse(o.at);
    if (t - paidAt > cfg.accessMs) return fail(410, "The download period for this purchase is over. Contact the shop owner with your order code.");
    if ((o.claims || 0) >= cfg.maxDownloads) return fail(429, "You have used all the downloads for this purchase. Contact the shop owner with your order code.");
    const file = cfg.fileMap[o.file];
    if (!file) return fail(410, "This file is no longer available. Contact the shop owner with your order code.");
    let grant;
    try { grant = await vp.files.grant(o.file, { ttl: 600, uses: 3 }); } catch (e) { return fail(410, "This file is no longer available. Contact the shop owner with your order code."); }
    await vp.data.update("orders", o.id, { claims: (o.claims || 0) + 1 });
    return { json: { url: grant.url, name: file.name, size: file.size, sha256: file.sha256, claimsLeft: Math.max(0, cfg.maxDownloads - (o.claims || 0) - 1) } };
  });
};
