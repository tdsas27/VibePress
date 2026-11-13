// Tests for the wallet address checks.   node plugin-kit/tests/validators.unit.js
const v = require("../../app/plugins/validators");
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log("  FAIL  " + n)); };
for (const a of ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"]) t("btc ok " + a, v["btc-address"](a) === a);
for (const a of ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb", "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", "Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9", "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx", "", "hello"]) t("btc bad " + a, v["btc-address"](a) === null);
t("keccak of nothing", v._keccak256(Buffer.alloc(0)).toString("hex") === "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
t("keccak of abc", v._keccak256(Buffer.from("abc")).toString("hex") === "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
for (const a of ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"]) t("eth ok " + a, v["eth-address"](a) === a);
for (const a of ["0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe", "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0x0000000000000000000000000000000000000000", "0xZZAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"]) t("eth bad " + a, v["eth-address"](a) === null);
const z = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"; t("ton null address", v["ton-address"](z) === z); t("ton raw", v["ton-address"]("0:" + "ab".repeat(32)) === "0:" + "ab".repeat(32));
t("ton typo", v["ton-address"](z.slice(0, 10) + "B" + z.slice(11)) === null); t("ton short", v["ton-address"](z.slice(1)) === null);
const mk = (flag, wc) => { const b = Buffer.alloc(36); b[0] = flag; b[1] = wc; for (let i = 0; i < 32; i++) b[2 + i] = i * 7 + 1; b.writeUInt16BE(v._crc16(b.subarray(0, 34)), 34); return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_"); };
t("ton bounceable", !!v["ton-address"](mk(0x11, 0))); t("ton non-bounceable (UQ)", mk(0x51, 0).startsWith("UQ") && !!v["ton-address"](mk(0x51, 0))); t("ton testnet flag rejected", v["ton-address"](mk(0x91, 0)) === null);
console.log(`\n${ok} passed, ${bad} failed.\n`); process.exit(bad ? 1 : 0);
