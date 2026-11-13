/* Address checks for settings fields ("check": "btc-address" | "eth-address" | "ton-address").
   They catch typos before an owner saves a wallet address that would send money nowhere. Mainnet only. Each returns the cleaned address or null. */
const crypto = require("crypto");

/* ---------- Bitcoin: Base58Check and Bech32 / Bech32m ---------- */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sha256 = b => crypto.createHash("sha256").update(b).digest();
function base58check(s) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{26,35}$/.test(s)) return false;
  let n = 0n; for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex;
  let bytes = Buffer.from(hex, "hex"); const zeros = s.match(/^1*/)[0].length;
  bytes = Buffer.concat([Buffer.alloc(zeros), bytes]);
  if (bytes.length !== 25) return false;
  const ok = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4).equals(bytes.subarray(21));
  return ok && (bytes[0] === 0x00 || bytes[0] === 0x05);                 // mainnet P2PKH or P2SH
}
const CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(v) { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const t = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= G[i]; } return c >>> 0; }
function bech32(s) {
  if (s.length < 14 || s.length > 90 || (s !== s.toLowerCase() && s !== s.toUpperCase())) return false;
  s = s.toLowerCase(); const p = s.lastIndexOf("1"); if (p < 1 || s.slice(0, p) !== "bc" || s.length - p < 7) return false;
  const d = []; for (const ch of s.slice(p + 1)) { const i = CH.indexOf(ch); if (i < 0) return false; d.push(i); }
  const hrp = [3, 3, 0, 2, 3], pm = polymod(hrp.concat(d));
  const ver = d[0], prog = d.slice(1, -6);
  if (ver > 16) return false;
  if (pm !== (ver === 0 ? 1 : 0x2bc830a3)) return false;                 // bech32 for v0, bech32m for v1+
  let acc = 0, bits = 0; const out = [];                                  // 5-bit groups back to bytes, padding must be clean
  for (const v of prog) { acc = (acc << 5) | v; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); } acc &= (1 << bits) - 1; }
  if (bits >= 5 || acc) return false;
  if (out.length < 2 || out.length > 40) return false;
  return ver === 0 ? (out.length === 20 || out.length === 32) : (ver === 1 ? out.length === 32 : true);
}
const btc = a => { a = String(a).trim(); return (base58check(a) || bech32(a)) ? a : null; };

/* ---------- Ethereum: 0x + 40 hex; mixed-case must pass the EIP-55 checksum ---------- */
const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]], M64 = (1n << 64n) - 1n;
const rotl = (x, n) => n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64 : x;
function keccak256(input) {
  const rate = 136, st = new Array(25).fill(0n), buf = Buffer.concat([input, Buffer.from([0x01]), Buffer.alloc(rate - ((input.length + 1) % rate || rate))]); buf[buf.length - 1] |= 0x80;
  const full = buf.length % rate === 0 ? buf : Buffer.concat([buf, Buffer.alloc(rate - (buf.length % rate))]);
  for (let off = 0; off < full.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) st[i] ^= full.readBigUInt64LE(off + i * 8);
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map(x => st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20]);
      for (let x = 0; x < 5; x++) { const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) st[y + x] ^= D; }
      const B = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(st[x + 5 * y], ROT[x][y]);
      for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) st[y + x] = B[y + x] ^ (~B[y + (x + 1) % 5] & M64 & B[y + (x + 2) % 5]);
      st[0] ^= RC[r];
    }
  }
  const out = Buffer.alloc(32); for (let i = 0; i < 4; i++) out.writeBigUInt64LE(st[i], i * 8); return out;
}
const eth = a => {
  a = String(a).trim(); if (!/^0x[0-9a-fA-F]{40}$/.test(a) || /^0x0{40}$/.test(a)) return null;
  const h = a.slice(2);
  if (h !== h.toLowerCase() && h !== h.toUpperCase()) {                    // mixed case carries a checksum: it must be right
    const hash = keccak256(Buffer.from(h.toLowerCase(), "ascii")).toString("hex");
    for (let i = 0; i < 40; i++) if (/[a-f]/i.test(h[i]) && (parseInt(hash[i], 16) >= 8) !== (h[i] === h[i].toUpperCase())) return null;
  }
  return a;
};

/* ---------- TON: friendly (48 characters, CRC16) or raw 0:<64 hex> ---------- */
function crc16(b) { let c = 0; for (const x of b) { c ^= x << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }
const ton = a => {
  a = String(a).trim();
  if (/^(0|-1):[0-9a-fA-F]{64}$/.test(a)) return a;
  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(a)) return null;
  const b = Buffer.from(a.replace(/-/g, "+").replace(/_/g, "/"), "base64"); if (b.length !== 36) return null;
  if (crc16(b.subarray(0, 34)) !== b.readUInt16BE(34)) return null;
  if ((b[0] & 0x80) || ((b[0] & 0x7f) !== 0x11 && (b[0] & 0x7f) !== 0x51)) return null;   // testnet-only flag or unknown type
  return (b[1] === 0 || b[1] === 0xff) ? a : null;
};

module.exports = { "btc-address": btc, "eth-address": eth, "ton-address": ton, _keccak256: keccak256, _crc16: crc16 };
