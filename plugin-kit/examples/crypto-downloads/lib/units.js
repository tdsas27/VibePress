// Exact money maths. Amounts are whole numbers of the smallest unit (satoshi, wei, nanoton) held in BigInt; text like "0.0005" is only
// ever converted by moving the decimal point, never through floating point.
exports.toUnits = function (text, decimals) {
  const m = /^(\d{1,9})(?:\.(\d{1,18}))?$/.exec(String(text));
  if (!m) throw new Error("not a plain decimal number");
  const frac = m[2] || "";
  if (frac.length > decimals) throw new Error("too many decimal places for this coin");
  return BigInt(m[1] + frac.padEnd(decimals, "0"));
};

exports.fromUnits = function (units, decimals) {
  const s = BigInt(units).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? whole + "." + frac : whole;
};

exports.abs = function (x) { return x < 0n ? -x : x; };
