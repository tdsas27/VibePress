/* A small QR code encoder (byte mode, error correction level M, versions 1 to 10, so up to 213 bytes of text).
   Used to draw payment QR codes without loading anything from another website.
   QR.matrix(text) -> array of rows of booleans (true = dark).   QR.draw(canvas, text, pixelsPerModule) -> draws it with a quiet border. */
(function (root) {
  var ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];   // level M, versions 1..10

  function rawCodewords(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return Math.floor(r / 8);
  }
  function dataCodewords(v) { return rawCodewords(v) - ECC[v - 1] * BLOCKS[v - 1]; }

  function mul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
  function divisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (i = 0; i < deg; i++) { for (var j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = mul(root, 2); }
    return r;
  }
  function remainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) { var f = b ^ r.shift(); r.push(0); div.forEach(function (c, i) { r[i] ^= mul(c, f); }); });
    return r;
  }
  function utf8(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }

  function codewords(bytes, v) {
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(v) * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = []; for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }

    var nb = BLOCKS[v - 1], el = ECC[v - 1], raw = rawCodewords(v), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), blocks = [], div = divisor(el), pos = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(pos, pos + shortLen - el + (i < nShort ? 0 : 1)); pos += dat.length;
      var ecc = remainder(dat, div); if (i < nShort) dat.push(0); blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) blocks.forEach(function (blk, j) { if (i !== shortLen - el || j >= nShort) out.push(blk[i]); });
    return out;
  }

  function alignPositions(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, r = [6];
    for (var p = v * 4 + 10; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }

  function build(cw, v) {
    var size = v * 4 + 17, m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(x, y, d) { m[y][x] = !!d; fn[y][x] = true; }
    function bit(x, i) { return ((x >>> i) & 1) !== 0; }
    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy; if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4); }
    });
    var ap = alignPositions(v);
    ap.forEach(function (a, i) { ap.forEach(function (b, j) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }); });
    function format(mask) {
      var data = (0 << 3) | mask, rem = data;                                     // level M = 00
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412, j;
      for (j = 0; j <= 5; j++) set(8, j, bit(bits, j));
      set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8));
      for (j = 9; j < 15; j++) set(14 - j, 8, bit(bits, j));
      for (j = 0; j < 8; j++) set(size - 1 - j, 8, bit(bits, j));
      for (j = 8; j < 15; j++) set(8, size - 15 + j, bit(bits, j));
      set(8, size - 8, true);
    }
    format(0);
    if (v >= 7) {
      var rem = v; for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (v << 12) | rem;
      for (i = 0; i < 18; i++) { var c = bit(vb, i), a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, c); set(b, a, c); }
    }
    var k2 = 0;                                                                   // data bits, zigzag from the bottom right
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j2 = 0; j2 < 2; j2++) {
        var x = right - j2, up = ((right + 1) & 2) === 0, yy2 = up ? size - 1 - vert : vert;
        if (!fn[yy2][x] && k2 < cw.length * 8) { m[yy2][x] = bit(cw[k2 >>> 3], 7 - (k2 & 7)); k2++; }
      }
    }
    var best = -1, bestScore = 1e9;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(m, fn, mask, size); format(mask);
      var s = penalty(m, size); if (s < bestScore) { bestScore = s; best = mask; }
      applyMask(m, fn, mask, size);
    }
    applyMask(m, fn, best, size); format(best);
    return m;
  }
  function applyMask(m, fn, mask, size) {
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      var inv; switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = x * y % 2 + x * y % 3 === 0; break;
        case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break; default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
      }
      if (inv) m[y][x] = !m[y][x];
    }
  }
  function penalty(m, size) {
    var s = 0, x, y, dark = 0, run, i;
    function line(get) {                                                         // runs of 5+ and finder-like patterns along one line
      run = 1; var hist = "";
      for (i = 0; i < size; i++) { var c = get(i); hist += c ? "1" : "0"; if (i > 0 && c === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; }
      var re = /10111010000|00001011101/g; while (re.exec(hist)) { s += 40; re.lastIndex -= 10; }
    }
    for (y = 0; y < size; y++) line(function (i) { return m[y][i]; });
    for (x = 0; x < size; x++) line(function (i) { return m[i][x]; });
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) s += 3;
    }
    var total = size * size, k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return s + Math.max(k, 0) * 10;
  }

  function matrix(text) {
    var bytes = utf8(String(text)), v = 1;
    while (v <= 10 && dataCodewords(v) * 8 < 4 + (v < 10 ? 8 : 16) + bytes.length * 8) v++;
    if (v > 10) throw new Error("Text is too long for this QR code");
    return build(codewords(bytes, v), v);
  }
  function draw(canvas, text, px) {
    var m = matrix(text), n = m.length, q = 4, s = px || 4, ctx = canvas.getContext("2d");
    canvas.width = canvas.height = (n + q * 2) * s;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#000";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) ctx.fillRect((x + q) * s, (y + q) * s, s, s);
  }
  root.QR = { matrix: matrix, draw: draw };
})(typeof window !== "undefined" ? window : this);
