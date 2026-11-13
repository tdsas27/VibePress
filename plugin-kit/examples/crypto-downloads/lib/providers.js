// Looks up recent incoming payments for an address from public blockchain APIs, through vp.fetch (so only the hosts listed in
// plugin.json can be reached). Every adapter returns the same shape:
//   [{ id, units, time, confs, comment, ok }]   units = whole smallest units as text, time = ms or null, confs = number or null
// The parse* functions are separate so they can be tested against saved API answers.

const num = function (x) { const n = Number(x); return Number.isFinite(n) ? n : null; };
const big = function (x) { try { return BigInt(String(x)).toString(); } catch (e) { return "0"; } };

// ---------- Bitcoin: Esplora API (mempool.space and blockstream.info answer the same questions the same way) ----------
exports.parseBtc = function (list, address, tip) {
  const want = /^bc1/i.test(address) ? address.toLowerCase() : address, out = [];
  (Array.isArray(list) ? list : []).slice(0, 50).forEach(function (t) {
    if (!t || typeof t.txid !== "string") return;
    let sum = 0n;
    (Array.isArray(t.vout) ? t.vout : []).forEach(function (o) { if (o && o.scriptpubkey_address === want) sum += BigInt(Math.round(Number(o.value) || 0)); });
    if (sum <= 0n) return;
    const st = t.status || {}, confirmed = st.confirmed === true;
    let confs = 0;
    if (confirmed) confs = tip && num(st.block_height) ? Math.max(1, tip - st.block_height + 1) : 1;
    out.push({ id: t.txid, units: sum.toString(), time: confirmed && num(st.block_time) ? st.block_time * 1000 : null, confs: confs, comment: null, ok: true });
  });
  return out;
};

// ---------- Ethereum: Blockscout API v2 ----------
exports.parseEth = function (body, address) {
  const items = body && Array.isArray(body.items) ? body.items : [], want = address.toLowerCase(), out = [];
  items.slice(0, 50).forEach(function (t) {
    if (!t || typeof t.hash !== "string") return;
    const to = t.to && typeof t.to.hash === "string" ? t.to.hash.toLowerCase() : "";
    if (to !== want) return;
    const ok = t.status === "ok" || t.result === "success";
    const ts = Date.parse(t.timestamp);
    out.push({ id: t.hash, units: big(t.value), time: Number.isFinite(ts) ? ts : null, confs: num(t.confirmations), comment: null, ok: ok });
  });
  return out;
};

// ---------- TON: TonAPI and toncenter (v3) ----------
exports.parseTonapi = function (body) {
  const list = body && Array.isArray(body.transactions) ? body.transactions : [], out = [];
  list.slice(0, 50).forEach(function (t) {
    const m = t && t.in_msg;
    if (!m || typeof t.hash !== "string" || !(Number(m.value) > 0)) return;
    const text = m.decoded_body && typeof m.decoded_body.text === "string" ? m.decoded_body.text.trim() : null;
    out.push({ id: t.hash, units: big(m.value), time: num(t.utime) ? t.utime * 1000 : null, confs: null, comment: text, ok: t.success !== false });
  });
  return out;
};
exports.parseToncenter = function (body) {
  const list = body && Array.isArray(body.transactions) ? body.transactions : [], out = [];
  list.slice(0, 50).forEach(function (t) {
    const m = t && t.in_msg;
    if (!m || typeof t.hash !== "string" || !(Number(m.value) > 0)) return;
    const d = m.message_content && m.message_content.decoded, text = d && typeof d.comment === "string" ? d.comment.trim() : null;
    out.push({ id: t.hash, units: big(m.value), time: num(t.now) ? t.now * 1000 : null, confs: null, comment: text, ok: !(t.description && t.description.aborted === true) });
  });
  return out;
};

// ---------- fetching, with fallbacks and a shared time budget ----------
// ctx = { left(): ms remaining in this visitor request, confsNeeded }
exports.make = function (vp) {
  async function get(url, ctx) {
    const left = ctx.left();
    if (left < 1200) throw new Error("out of time");
    const r = await vp.fetch(url, { timeout: Math.min(3500, left - 500) });
    if (r.status !== 200) throw new Error("answered " + r.status);
    return r;
  }
  async function firstWorking(tries) {
    let last = new Error("no provider");
    for (const t of tries) { try { return await t(); } catch (e) { last = e; } }
    throw last;
  }
  return {
    btc: function (address, ctx) {
      return firstWorking(["mempool.space", "blockstream.info"].map(function (h) {
        return async function () {
          const list = (await get("https://" + h + "/api/address/" + address + "/txs", ctx)).json();
          let tip = 0;
          if (ctx.confsNeeded > 1) tip = parseInt((await get("https://" + h + "/api/blocks/tip/height", ctx)).text, 10) || 0;
          return exports.parseBtc(list, address, tip);
        };
      }));
    },
    eth: function (address, ctx) {
      return firstWorking([async function () {
        return exports.parseEth((await get("https://eth.blockscout.com/api/v2/addresses/" + address + "/transactions?filter=to", ctx)).json(), address);
      }]);
    },
    ton: function (address, ctx) {
      return firstWorking([
        async function () { return exports.parseTonapi((await get("https://tonapi.io/v2/blockchain/accounts/" + address + "/transactions?limit=50", ctx)).json()); },
        async function () { return exports.parseToncenter((await get("https://toncenter.com/api/v3/transactions?account=" + address + "&limit=50&sort=desc", ctx)).json()); }
      ]);
    }
  };
};
