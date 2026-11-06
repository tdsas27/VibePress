/* IP helpers (IPv4 + IPv6) using BigInt: parse, match, convert ranges to CIDR. No dependencies. */
const net = require("net");
const toBig = s => {
  try {
    let a = String(s).trim().split("%")[0];
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); if (m) a = m[1];
    const t = net.isIP(a); if (!t) return null;
    if (t === 4) return { v: 4, n: a.split(".").reduce((x, o) => (x << 8n) + BigInt(o), 0n) };
    const [h, tl] = a.split("::"), head = h ? h.split(":") : [], rest = tl ? tl.split(":") : [];
    const parts = a.includes("::") ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest] : head;
    if (parts.length !== 8) return null;
    return { v: 6, n: parts.reduce((x, p) => (x << 16n) + BigInt("0x" + p), 0n) };
  } catch { return null; }
};
const toStr = (n, v) => v === 4 ? [24n, 16n, 8n, 0n].map(s => ((n >> s) & 255n).toString()).join(".")
  : Array.from({ length: 8 }, (_, i) => ((n >> BigInt((7 - i) * 16)) & 0xffffn).toString(16)).join(":");
const parseRule = text => {
  text = String(text).trim();
  if (/^[A-Za-z]{2}$/.test(text)) return { kind: "country", code: text.toUpperCase(), text: text.toUpperCase() };
  if (text.includes("/")) {                                   // subnet, e.g. 203.0.113.0/24
    const [a, p] = text.split("/"), b = toBig(a);
    if (!b || !/^\d{1,3}$/.test(p)) return null;
    const bits = b.v === 4 ? 32 : 128, pre = +p;
    if (pre > bits || pre < (b.v === 4 ? 8 : 16)) return null; // refuse huge ranges that could block everyone
    const host = (1n << BigInt(bits - pre)) - 1n, lo = b.n & ~host;
    return { kind: "cidr", v: b.v, lo, hi: lo | host, text: toStr(lo, b.v) + "/" + pre };
  }
  if (text.includes("-")) {                                   // range, e.g. 203.0.113.5-203.0.113.90
    const p = text.split("-"); if (p.length !== 2) return null;
    const a = toBig(p[0]), b = toBig(p[1]);
    if (!a || !b || a.v !== b.v || a.n > b.n) return null;
    return { kind: "range", v: a.v, lo: a.n, hi: b.n, text: toStr(a.n, a.v) + "-" + toStr(b.n, b.v) };
  }
  const b = toBig(text);
  return b ? { kind: "ip", v: b.v, lo: b.n, hi: b.n, text: toStr(b.n, b.v) } : null;
};
const contains = (r, b) => r.v === b.v && r.lo <= b.n && b.n <= r.hi;
const toCidrs = r => {
  const bits = r.v === 4 ? 32 : 128, out = []; let lo = r.lo;
  while (lo <= r.hi) {
    let size = lo === 0n ? (1n << BigInt(bits)) : (lo & -lo);
    while (size > r.hi - lo + 1n) size >>= 1n;
    out.push(toStr(lo, r.v) + "/" + (bits - (size.toString(2).length - 1))); lo += size;
  }
  return out;
};
const isPrivate = addr => {
  const b = toBig(addr); if (!b) return false;
  if (b.v === 4) { const o = Number(b.n >> 24n), s = Number((b.n >> 16n) & 255n);
    return o === 10 || o === 127 || o === 0 || (o === 172 && s >= 16 && s <= 31) || (o === 192 && s === 168) || (o === 169 && s === 254); }
  return b.n === 1n || (b.n >> 121n) === 0x7en || (b.n >> 118n) === 0x3fan;
};
module.exports = { toBig, toStr, parseRule, contains, toCidrs, isPrivate };
