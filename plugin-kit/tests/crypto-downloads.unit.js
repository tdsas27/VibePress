// Unit tests for the Crypto Downloads plugin: payment matching, parsing, ordering, claiming. Plain Node, no server needed:
//   node plugin-kit/tests/crypto-downloads.unit.js
const path = require("path"), P = path.join(__dirname, "..", "examples", "crypto-downloads");
const providers = require(P + "/lib/providers"), units = require(P + "/lib/units"), server = require(P + "/server.js");
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "  PASS  " : "  FAIL  ") + n + (c ? "" : "  -> " + String(x).slice(0, 220))); };
const BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", ETH = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", TON = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const HOUR = 3600000;

// ---- a stand-in for the `vp` object the sandbox provides ----
function world(over) {
  const w = { kv: {}, orders: [], seq: 0, calls: [], files: [{ id: "f1f1f1f1f1f1", name: "ebook.pdf", size: 1234, sha256: "ab".repeat(32) }], routes: {}, fetchImpl: async () => { throw new Error("no network in this test"); },
    settings: { values: { btc_address: BTC, eth_address: ETH, ton_address: TON, btc_confirmations: 1, eth_confirmations: 12, order_minutes: 60, max_downloads: 3, access_days: 30 },
      lists: { products: [{ id: "aaaaaaaaaa", title: "Ebook", description: "d", file: "f1f1f1f1f1f1", btc: "0.0005", eth: "0.01", ton: "5" }] } } };
  Object.assign(w, over || {});
  const clone = x => x === undefined ? null : JSON.parse(JSON.stringify(x)), flat = o => clone(o);
  const vp = { route: (m, p, f) => { w.routes[m + " " + p] = f; }, log: () => {},
    kv: { get: async k => clone(w.kv[k]), set: async (k, v) => { w.kv[k] = clone(v); return true; } },
    settings: { get: async () => clone(w.settings) }, files: { list: async () => clone(w.files), grant: async (id, o) => { if (w.grantFails) throw new Error("x"); w.grants = (w.grants || 0) + 1; return { url: "/x-api/crypto-downloads/dl/TOKEN" + w.grants, expires: Date.now() + 600000 }; } },
    fetch: async (url, o) => { w.calls.push({ url, o }); const r = await w.fetchImpl(url, o); return { status: r.status === undefined ? 200 : r.status, text: typeof r.body === "string" ? r.body : JSON.stringify(r.body), json() { return typeof r.body === "string" ? JSON.parse(r.body) : r.body; } }; },
    data: {
      add: async (c, v, o) => { const e = Object.assign({ id: (++w.seq).toString(16).padStart(10, "0"), at: new Date().toISOString(), approved: !!(o && o.approved) }, JSON.parse(JSON.stringify(v))); w.orders.push(e); return flat(e); },
      find: async (c, f, v) => { for (let i = w.orders.length - 1; i >= 0; i--) if (w.orders[i][f] === v) return flat(w.orders[i]); return null; },
      update: async (c, id, v) => { const e = w.orders.find(x => x.id === id); if (!e) return null; Object.assign(e, JSON.parse(JSON.stringify(v))); return flat(e); },
      approve: async (c, id, on) => { const e = w.orders.find(x => x.id === id); if (!e) return null; e.approved = !!on; return flat(e); },
      list: async (c, o) => w.orders.filter(e => !o || o.approved === undefined || e.approved === o.approved).slice(-((o && o.limit) || 50)).reverse().map(flat) } };
  server(vp);
  w.call = async (m, p, req) => { const f = w.routes[m + " " + p]; const out = await f(Object.assign({ method: m, path: p, query: {}, body: null, visitor: "v" + Math.random() }, req || {})); return Object.assign({ status: 200 }, out); };
  return w;
}
const post = (w, body, visitor) => w.call("POST", "/order", { body, visitor: visitor || "v" + Math.random() });
const stat = (w, code) => w.call("GET", "/status", { query: { code } });
const btcTx = (o, over) => Object.assign({ txid: "tx" + Math.random().toString(16).slice(2), status: { confirmed: true, block_height: 800000, block_time: Math.floor(Date.now() / 1000) }, vout: [{ scriptpubkey_address: BTC, value: Number(o.units) }, { scriptpubkey_address: "bc1qother", value: 99999 }] }, over || {});
const ethItem = (o, over) => Object.assign({ hash: "0x" + Math.random().toString(16).slice(2), to: { hash: ETH.toLowerCase() }, value: o.units, status: "ok", confirmations: 20, timestamp: new Date().toISOString() }, over || {});
const tonTx = (o, over) => Object.assign({ hash: "h" + Math.random().toString(16).slice(2), utime: Math.floor(Date.now() / 1000), success: true, in_msg: { value: Number(o.units), decoded_body: { text: o.memo } } }, over || {});
const route = (w, handlers) => { w.fetchImpl = async url => { for (const k of Object.keys(handlers)) if (url.includes(k)) { const h = handlers[k]; return typeof h === "function" ? h(url) : (h && !Array.isArray(h) && "body" in h ? h : { body: h }); } throw new Error("unexpected " + url); }; };
// make the order look older / the poll throttle open
const age = (w, code, ms) => { const o = w.orders.find(x => x.code === code); o.at = new Date(Date.parse(o.at) - ms).toISOString(); o.exp -= ms; o.checked = 0; };
const unthrottle = (w, code) => { w.orders.find(x => x.code === code).checked = 0; delete w.kv["c:btc"]; delete w.kv["c:eth"]; delete w.kv["c:ton"]; delete w.kv["l:btc"]; delete w.kv["l:eth"]; delete w.kv["l:ton"]; };

(async () => {
  console.log("\n-- parsing the public APIs --");
  let r = providers.parseBtc([{ txid: "a", status: { confirmed: true, block_height: 100, block_time: 1700000000 }, vout: [{ scriptpubkey_address: BTC, value: 30000 }, { scriptpubkey_address: BTC, value: 20037 }, { scriptpubkey_address: "x", value: 5 }] }, { txid: "b", status: { confirmed: false }, vout: [{ scriptpubkey_address: BTC, value: 7 }] }, { txid: "c", status: { confirmed: true }, vout: [{ scriptpubkey_address: "other", value: 9 }] }, null, { nope: 1 }], BTC.toUpperCase(), 104);
  ok("btc: sums outputs to our address (even for an upper-case bech32 setting), skips others", r.length === 2 && r[0].units === "50037" && r[1].units === "7", JSON.stringify(r));
  ok("btc: confirmations come from the tip height; unconfirmed has none and no time", r[0].confs === 5 && r[0].time === 1700000000000 && r[1].confs === 0 && r[1].time === null);
  ok("btc: garbage input gives an empty list", providers.parseBtc("nonsense", BTC, 0).length === 0 && providers.parseBtc(null, BTC, 0).length === 0);
  r = providers.parseEth({ items: [{ hash: "0x1", to: { hash: ETH.toLowerCase() }, value: "10003715000000000", status: "ok", confirmations: 30, timestamp: "2026-11-07T10:00:00Z" }, { hash: "0x2", to: { hash: "0xdead" }, value: "5", status: "ok" }, { hash: "0x3", to: { hash: ETH }, value: "9", status: "error", result: "reverted" }, { hash: "0x4", to: { hash: ETH }, value: "9", result: "success" }] }, ETH);
  ok("eth: keeps payments to us (any letter case), skips other recipients", r.length === 3 && r[0].units === "10003715000000000" && r[0].confs === 30);
  ok("eth: failed transactions are marked not ok; unknown confirmations are null", r[1].ok === false && r[2].ok === true && r[2].confs === null && r[0].time === Date.parse("2026-11-07T10:00:00Z"));
  r = providers.parseTonapi({ transactions: [{ hash: "h1", utime: 1700000000, success: true, in_msg: { value: 5000000123, decoded_body: { text: " CDABC123 " } } }, { hash: "h2", success: false, in_msg: { value: 1, decoded_body: { text: "x" } } }, { hash: "h3", in_msg: { value: 0 } }, { hash: "h4", in_msg: { value: 9 } }] });
  ok("tonapi: reads value and trimmed comment; zero-value skipped; failed flagged; no comment is null", r.length === 3 && r[0].units === "5000000123" && r[0].comment === "CDABC123" && r[1].ok === false && r[2].comment === null);
  r = providers.parseToncenter({ transactions: [{ hash: "t1", now: 1700000000, description: { aborted: false }, in_msg: { value: "6000000000", message_content: { decoded: { type: "text_comment", comment: "CDXYZ789" } } } }, { hash: "t2", description: { aborted: true }, in_msg: { value: "1" } }] });
  ok("toncenter: reads string values, comment, aborted transactions not ok", r.length === 2 && r[0].units === "6000000000" && r[0].comment === "CDXYZ789" && r[1].ok === false);

  console.log("\n-- catalog --");
  let w = world(); let c = (await w.call("GET", "/catalog")).json;
  ok("catalog lists the product with prices and no secrets", c.configured && c.products.length === 1 && c.products[0].prices.btc === "0.0005" && !JSON.stringify(c).includes(BTC) && c.products[0].file.name === "ebook.pdf", JSON.stringify(c));
  w = world({ files: [] }); ok("a product whose file is gone is not offered (shop not configured)", (await w.call("GET", "/catalog")).json.configured === false);
  w = world(); w.settings.values.btc_address = undefined; w.settings.values.eth_address = undefined; c = (await w.call("GET", "/catalog")).json;
  ok("only coins with an address are offered", Object.keys(c.products[0].prices).join() === "ton" && Object.keys(c.coins).join() === "ton", JSON.stringify(c));
  w = world(); w.settings.lists.products[0].btc = "0.123456789"; ok("a price with too many decimals for the coin is not offered for it", !("btc" in (await w.call("GET", "/catalog")).json.products[0].prices));
  w = world(); w.settings.lists.products[0].btc = "0"; ok("a zero price is never offered", !("btc" in (await w.call("GET", "/catalog")).json.products[0].prices));

  console.log("\n-- creating orders --");
  w = world(); let o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json;
  ok("btc order: amount is the price plus 1 to 300 satoshi, address is the owner's", o.address === BTC && Number(units.toUnits(o.amount, 8) - 50000n) >= 1 && Number(units.toUnits(o.amount, 8) - 50000n) <= 300 && /^[a-f0-9]{24}$/.test(o.code), JSON.stringify(o));
  ok("btc order: payment link carries the exact amount", o.uri === "bitcoin:" + BTC + "?amount=" + o.amount);
  o = (await post(w, { product: "aaaaaaaaaa", coin: "eth" })).json;
  ok("eth order: price plus a few gwei, EIP-681 link with the exact wei", o.address === ETH && BigInt(w.orders[1].units) > 10000000000000000n && BigInt(w.orders[1].units) <= 10000000000000000n + 9999n * 1000000000n && o.uri === "ethereum:" + ETH + "@1?value=" + w.orders[1].units, o.uri);
  o = (await post(w, { product: "aaaaaaaaaa", coin: "ton" })).json;
  ok("ton order: exact price, a memo, and a link with the memo as the comment", o.amount === "5" && /^CD[A-Z2-9]{6}$/.test(o.memo) && o.uri === "ton://transfer/" + TON + "?amount=5000000000&text=" + o.memo, JSON.stringify(o));
  ok("the public order view never shows internal fields", !("units" in o) && !("file" in o) && !("id" in o));
  w = world(); const seen = new Set(); let dup = 0;
  for (let i = 0; i < 120; i++) { const x = await post(w, { product: "aaaaaaaaaa", coin: "btc" }); if (x.status !== 200) throw new Error("order failed " + JSON.stringify(x)); if (seen.has(x.json.amount)) dup++; seen.add(x.json.amount); }
  ok("120 open btc orders all have different amounts", dup === 0 && seen.size === 120);
  w = world(); const ethSet = []; for (let i = 0; i < 60; i++) ethSet.push(BigInt((await post(w, { product: "aaaaaaaaaa", coin: "eth" })).status === 200 ? w.orders[i].units : 0));
  ok("open eth orders are at least 1 gwei apart", ethSet.every((a, i) => ethSet.every((b, j) => i === j || units.abs(a - b) >= 1000000000n)));
  w = world(); for (let i = 0; i < 150; i++) await post(w, { product: "aaaaaaaaaa", coin: "btc" }); r = await post(w, { product: "aaaaaaaaaa", coin: "btc" });
  ok("when 150 btc orders are open the shop says it is busy (503)", r.status === 503, JSON.stringify(r));
  w = world(); const v = "same-visitor"; const rs = []; for (let i = 0; i < 4; i++) rs.push((await post(w, { product: "aaaaaaaaaa", coin: "btc" }, v)).status);
  ok("one visitor can start 3 orders per 10 minutes, the 4th is refused (429)", rs.join() === "200,200,200,429", rs.join());
  w = world(); ok("bad coin, bad product id and unknown product are refused", (await post(w, { product: "aaaaaaaaaa", coin: "doge" })).status === 400 && (await post(w, { product: "zz", coin: "btc" })).status === 400 && (await post(w, { product: "bbbbbbbbbb", coin: "btc" })).status === 400 && (await w.call("POST", "/order", { body: null })).status === 400);
  w = world(); w.settings.lists.products[0].eth = ""; ok("a coin the product has no price for is refused", (await post(w, { product: "aaaaaaaaaa", coin: "eth" })).status === 400);

  console.log("\n-- Bitcoin payments --");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; const exp = BigInt(w.orders[0].units);
  const pay = (units_, over) => { route(w, { "/txs": [btcTx({ units: String(units_) }, over)] }); unthrottle(w, o.code); return stat(w, o.code); };
  ok("no payment yet: still pending", (await (async () => { route(w, { "/txs": [] }); return stat(w, o.code); })()).json.status === "pending");
  ok("1 satoshi too little: not paid", (await pay(exp - 1n)).json.paid === false);
  ok("1 satoshi too much: not paid (the amount must match exactly)", (await pay(exp + 1n)).json.paid === false);
  ok("exact amount but unconfirmed: not paid", (await pay(exp, { status: { confirmed: false } })).json.paid === false);
  ok("exact amount sent to another address: not paid", (await (async () => { route(w, { "/txs": [{ txid: "z", status: { confirmed: true, block_time: Math.floor(Date.now() / 1000) }, vout: [{ scriptpubkey_address: "bc1qsomeoneelse", value: Number(exp) }] }] }); unthrottle(w, o.code); return stat(w, o.code); })()).json.paid === false);
  ok("exact amount confirmed long before the order existed: not paid", (await pay(exp, { status: { confirmed: true, block_height: 1, block_time: Math.floor((Date.now() - 3 * HOUR) / 1000) } })).json.paid === false);
  r = await pay(exp); ok("exact amount, confirmed, in time: PAID", r.json.paid === true && r.json.status === "paid", JSON.stringify(r));
  ok("the order now records the transaction and is marked paid for the owner", w.orders[0].approved === true && /^tx/.test(w.orders[0].txid) && w.orders[0].status === "paid");
  ok("the lookup asked the first provider, with a timeout under 3.5 s", w.calls.some(x => x.url.startsWith("https://mempool.space/api/address/" + BTC + "/txs")) && w.calls.every(x => x.o.timeout <= 3500));

  w = world(); w.settings.values.btc_confirmations = 3; o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; const e3 = w.orders[0].units;
  const h = { "/txs": () => ({ body: [btcTx({ units: e3 }, { status: { confirmed: true, block_height: 800000, block_time: Math.floor(Date.now() / 1000) } })] }) };
  route(w, Object.assign({ "/blocks/tip/height": { body: "800001" } }, h)); unthrottle(w, o.code); ok("3 confirmations needed, 2 so far: not paid yet", (await stat(w, o.code)).json.paid === false);
  route(w, Object.assign({ "/blocks/tip/height": { body: "800002" } }, h)); unthrottle(w, o.code); ok("3 confirmations needed, 3 reached: PAID", (await stat(w, o.code)).json.paid === true);

  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; const eb = w.orders[0].units;
  w.fetchImpl = async url => { if (url.startsWith("https://mempool.space")) throw new Error("down"); return { body: [btcTx({ units: eb })] }; };
  r = await stat(w, o.code); ok("first provider down: the second one is used and the payment is found", r.json.paid === true && w.calls.length === 2 && w.calls[1].url.startsWith("https://blockstream.info"), JSON.stringify(w.calls.map(x => x.url)));
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; w.fetchImpl = async () => { throw new Error("down"); };
  r = await stat(w, o.code); ok("both providers down: the order simply stays pending (no error shown to the buyer)", r.status === 200 && r.json.status === "pending");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; w.fetchImpl = async () => ({ status: 429, body: "slow down" });
  ok("a rate-limited provider (HTTP 429) is treated as a failure, not as 'no payment'", (await stat(w, o.code)).json.status === "pending");

  console.log("\n-- polling behaviour --");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; route(w, { "/txs": [] });
  await stat(w, o.code); const n1 = w.calls.length; await stat(w, o.code); await stat(w, o.code);
  ok("polling faster than every 8 seconds does not hammer the blockchain API", w.calls.length === n1, w.calls.length + " vs " + n1);
  w = world(); const a = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json, b = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; route(w, { "/txs": [] });
  await stat(w, a.code); const c1 = w.calls.length; await stat(w, b.code);
  ok("two buyers polling share one lookup (cached for 15 s)", w.calls.length === c1, w.calls.length + " vs " + c1);
  ok("a bad or unknown order code is refused", (await stat(w, "zz")).status === 400 && (await stat(w, "a".repeat(24))).status === 404);

  console.log("\n-- order windows --");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; const ex = w.orders[0].units; age(w, o.code, 61 * 60000);
  route(w, { "/txs": [btcTx({ units: ex })] }); r = await stat(w, o.code);
  ok("paid 61 minutes after the order (window is 60): still matched, because the grace period is 3 hours", r.json.paid === true);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; age(w, o.code, 5 * HOUR); route(w, { "/txs": [] }); r = await stat(w, o.code);
  ok("an order older than window + 3 hours becomes expired", r.json.status === "expired" && w.orders[0].status === "expired");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; const ee = w.orders[0].units; age(w, o.code, 3 * HOUR + 59 * 60000);   // the order's last matching minute is about 1 minute away
  const later = Math.floor((Date.now() + 5 * 60000) / 1000);
  route(w, { "/txs": [btcTx({ units: ee }, { status: { confirmed: true, block_height: 5, block_time: later } })] }); r = await stat(w, o.code);
  ok("a payment stamped after the order's matching window has closed is not accepted", r.json.paid === false, JSON.stringify(r.json));
  route(w, { "/txs": [btcTx({ units: ee })] }); unthrottle(w, o.code); r = await stat(w, o.code);
  ok("the same payment stamped inside the window is accepted", r.json.paid === true, JSON.stringify(r.json));
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; age(w, o.code, 61 * 60000);
  const open2 = []; for (let i = 0; i < 20; i++) { const x = await post(w, { product: "aaaaaaaaaa", coin: "btc" }); open2.push(x.json.amount); }
  ok("an order in its grace period still reserves its amount (no new order gets the same one)", !open2.includes(o.amount));

  console.log("\n-- replay and double use --");
  w = world(); const o1 = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json, o2 = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json;
  w.orders[1].units = w.orders[0].units;                                               // force the unlikely collision
  const T = btcTx({ units: w.orders[0].units }, { txid: "SHARED" }); route(w, { "/txs": [T] });
  await stat(w, o1.code); unthrottle(w, o2.code); r = await stat(w, o2.code);
  ok("one transaction can pay for only one order", w.orders[0].approved === true && w.orders[0].txid === "SHARED" && r.json.paid === false && !w.orders[1].txid);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; route(w, { "/txs": [btcTx({ units: w.orders[0].units }, { txid: "SAME" })] });
  await stat(w, o.code); w.orders[0].approved = false; w.orders[0].status = "pending"; unthrottle(w, o.code); r = await stat(w, o.code);
  ok("if a crash left an order half-updated, the same transaction still completes it", r.json.paid === true);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; await w.call("GET", "/status", { query: { code: o.code } }); w.orders[0].approved = true;
  r = await stat(w, o.code); ok("the owner marking an order paid by hand makes it paid (and fixes its status)", r.json.paid === true && w.orders[0].status === "paid" && w.orders[0].paidat > 0);

  console.log("\n-- Ethereum payments --");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "eth" })).json; const ue = BigInt(w.orders[0].units);
  const payE = (amt, over) => { route(w, { "blockscout": { body: { items: [ethItem({ units: amt.toString() }, over)] } } }); unthrottle(w, o.code); return stat(w, o.code); };
  ok("eth: 1 wei too little: not paid", (await payE(ue - 1n)).json.paid === false);
  ok("eth: a whole gwei too much: not paid", (await payE(ue + 1000000000n)).json.paid === false);
  ok("eth: confirmations unknown (API did not say): not paid, never guessed", (await payE(ue, { confirmations: undefined })).json.paid === false);
  ok("eth: only 11 of 12 confirmations: not paid", (await payE(ue, { confirmations: 11 })).json.paid === false);
  ok("eth: failed transaction: not paid", (await payE(ue, { status: "error", result: "reverted" })).json.paid === false);
  ok("eth: a payment to somebody else: not paid", (await payE(ue, { to: { hash: "0x1111111111111111111111111111111111111111" } })).json.paid === false);
  ok("eth: exact wei, 12 confirmations: PAID", (await payE(ue, { confirmations: 12 })).json.paid === true);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "eth" })).json; const u2 = BigInt(w.orders[0].units);
  route(w, { "blockscout": { body: { items: [ethItem({ units: (u2 + 999999999n).toString() })] } } }); unthrottle(w, o.code);
  ok("eth: up to 999999999 wei extra (wallet rounding) is accepted", (await stat(w, o.code)).json.paid === true);

  console.log("\n-- TON payments --");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "ton" })).json; const ot = w.orders[0];
  const payT = (over, inmsg) => { const t = tonTx(ot, over); if (inmsg) Object.assign(t.in_msg, inmsg); route(w, { "tonapi.io": { body: { transactions: [t] } } }); unthrottle(w, o.code); return stat(w, o.code); };
  ok("ton: right amount but no memo: not paid", (await payT({}, { decoded_body: undefined })).json.paid === false);
  ok("ton: right amount, someone else's memo: not paid", (await payT({}, { decoded_body: { text: "CDWRONG22" } })).json.paid === false);
  ok("ton: memo is case sensitive", (await payT({}, { decoded_body: { text: ot.memo.toLowerCase() } })).json.paid === false);
  ok("ton: correct memo, amount too small: not paid", (await payT({}, { value: 4999999999 })).json.paid === false);
  ok("ton: correct memo, failed transaction: not paid", (await payT({ success: false })).json.paid === false);
  ok("ton: correct memo, exact amount: PAID", (await payT({})).json.paid === true);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "ton" })).json; const ot2 = w.orders[0];
  route(w, { "tonapi.io": { body: { transactions: [tonTx(ot2, { in_msg: { value: 7000000000, decoded_body: { text: ot2.memo } } })] } } });
  ok("ton: paying more than the price is accepted", (await stat(w, o.code)).json.paid === true);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "ton" })).json; const ot3 = w.orders[0];
  w.fetchImpl = async url => { if (url.includes("tonapi.io")) throw new Error("down"); return { body: { transactions: [{ hash: "tc", now: Math.floor(Date.now() / 1000), description: { aborted: false }, in_msg: { value: "5000000000", message_content: { decoded: { type: "text_comment", comment: ot3.memo } } } }] } }; };
  ok("ton: tonapi down, toncenter answers: PAID", (await stat(w, o.code)).json.paid === true);

  console.log("\n-- claiming the file --");
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; const cl = () => w.call("POST", "/claim", { body: { code: o.code } });
  ok("claiming an unpaid order is refused (402)", (await cl()).status === 402);
  ok("claim with a bad code is refused", (await w.call("POST", "/claim", { body: { code: "x" } })).status === 400 && (await w.call("POST", "/claim", { body: { code: "a".repeat(24) } })).status === 402 && (await w.call("POST", "/claim", {})).status === 400);
  w.orders[0].approved = true; w.orders[0].status = "paid"; w.orders[0].paidat = Date.now();
  r = await cl(); ok("a paid order gets a short-lived link plus the file's name, size and checksum", r.status === 200 && /^\/x-api\/crypto-downloads\/dl\/TOKEN/.test(r.json.url) && r.json.name === "ebook.pdf" && r.json.sha256 === "ab".repeat(32) && r.json.claimsLeft === 2, JSON.stringify(r));
  await cl(); await cl(); r = await cl(); ok("after the allowed number of downloads (3) further claims are refused (429)", r.status === 429);
  w.orders[0].claims = 0; w.orders[0].paidat = Date.now() - 31 * 86400000; ok("after the access period (30 days) claims are refused (410)", (await cl()).status === 410);
  w.orders[0].paidat = Date.now(); w.files = []; ok("if the owner deleted the file, the buyer gets a clear message (410)", (await cl()).status === 410);
  w.files = [{ id: "f1f1f1f1f1f1", name: "ebook.pdf", size: 1, sha256: "cd".repeat(32) }]; w.grantFails = true; ok("if the link cannot be made, the buyer gets a clear message (410)", (await cl()).status === 410);
  w = world(); o = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; w.settings.lists.products = []; w.orders[0].approved = true; w.orders[0].paidat = Date.now();
  ok("a buyer can still download after the owner removed the product from the shop (the order remembers its file)", (await w.call("POST", "/claim", { body: { code: o.code } })).status === 200);

  console.log("\n-- the owner's setup check (/__status) --");
  const chk = async w => (await w.call("GET", "/__status")).json.items, has = (items, re, ok) => items.some(i => re.test(i.text) && (ok === undefined || i.ok === ok));
  let it = await chk(world({ files: [], settings: { values: {}, lists: { products: [] } } }));
  ok("nothing set up: it names all three missing pieces and says the shop is not open", has(it, /No files uploaded/, false) && has(it, /No wallet address/, false) && has(it, /No products/, false) && has(it, /NOT open/, false) && it.filter(i => !i.ok && i.fix).length >= 4, JSON.stringify(it));
  it = await chk(world({ settings: { values: { btc_address: BTC }, lists: { products: [] } } }));
  ok("an address and a file but no product: it says to add a product", has(it, /1 file uploaded/, true) && has(it, /Accepting Bitcoin/, true) && has(it, /No products/, false) && has(it, /NOT open/, false));
  w = world(); w.settings.values = { ton_address: TON }; it = await chk(w);
  ok("a price in a coin without an address (the easy mistake): the product sells where it can, and the ignored prices are named", has(it, /"Ebook" is on sale for TON 5/, true) && has(it, /has prices that are ignored: it has a BTC price but you have not entered a Bitcoin address; it has an ETH price but you have not entered an Ethereum address/, false) && has(it, /shop is open with 1 product/, true), JSON.stringify(it.map(i => i.text)));
  w = world(); w.settings.values = { ton_address: TON }; w.settings.lists.products[0].ton = ""; it = await chk(w);
  ok("when the only prices are for coins without an address, the product is not on sale and the reason is given", has(it, /"Ebook" is not on sale: it has a BTC price but you have not entered a Bitcoin address/, false) && has(it, /NOT open/, false), JSON.stringify(it.map(i => i.text)));
  w = world(); w.settings.lists.products[0].file = ""; it = await chk(w); ok("a product with no file chosen is explained", has(it, /no file chosen/, false) && has(it, /NOT open/, false));
  w = world(); w.files = []; it = await chk(w); ok("a product whose file was deleted is explained", has(it, /its file was deleted/, false));
  w = world(); w.settings.lists.products[0] = Object.assign({}, w.settings.lists.products[0], { btc: "0.123456789", eth: "", ton: "" }); it = await chk(w); ok("too many decimal places for a coin is explained", has(it, /BTC price has too many decimal places/, false));
  w = world(); w.settings.lists.products[0] = Object.assign({}, w.settings.lists.products[0], { btc: "", eth: "", ton: "" }); it = await chk(w); ok("a product with no price at all is explained", has(it, /no price in any coin/, false));
  w = world(); it = await chk(w); ok("a correct setup: product on sale for every coin and the shop is open", has(it, /"Ebook" is on sale for BTC 0\.0005, ETH 0\.01, TON 5/, true) && has(it, /shop is open with 1 product/, true) && it.every(i => i.ok), JSON.stringify(it));
  w = world(); const oo = (await post(w, { product: "aaaaaaaaaa", coin: "btc" })).json; it = await chk(w); ok("it also counts orders", has(it, /1 order so far, 0 paid/, true));
  w = world(); w.settings.lists.products.push({ id: "bbbbbbbbbb", title: "Broken", file: "", ton: "3" }); it = await chk(w); ok("with one good and one broken product, the good one is on sale and the broken one explained", has(it, /"Ebook" is on sale/, true) && has(it, /"Broken" is not on sale: no file chosen/, false) && has(it, /shop is open with 1 product/, true));
  ok("the check never shows the owner's secrets to the buyer's catalog", !JSON.stringify((await world().call("GET", "/catalog")).json).includes("Setup"));

  console.log(`\n${pass} passed, ${fail} failed.\n`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
