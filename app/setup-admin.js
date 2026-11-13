/* One-time admin creation: password + Authy QR + recovery codes. Run on the server:  npm run setup */
require("dotenv").config();
const readline = require("readline"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const bcrypt = require("bcryptjs"), qr = require("qrcode-terminal");
const { authenticator } = require("otplib");
authenticator.options = { window: 1 };
const DIR = path.join(__dirname, "data"), FILE = path.join(DIR, "admin.json");

const ask = (q, secret) => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (secret) rl._writeToOutput = s => rl.output.write(s.includes(q) ? s : "*");
  rl.question(q, a => { rl.close(); if (secret) console.log(""); res(a.trim()); });
});

(async () => {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(FILE) && (await ask("An admin already exists. Type RESET to replace it: ")) !== "RESET") return console.log("Cancelled.");
  const username = await ask("Admin username: ");
  if (username.length < 3) return console.log("Username too short.");
  const pw = await ask("Password (12+ characters): ", true);
  if (pw.length < 12 || pw !== await ask("Repeat password: ", true)) return console.log("Password too short or not matching. Nothing saved.");

  const secret = authenticator.generateSecret();
  console.log("\nScan this QR code in Authy (Add Account > Scan QR Code):\n");
  qr.generate(authenticator.keyuri(username, require("./brand").name, secret), { small: true });
  console.log("Manual key if scanning fails: " + secret + "\n");

  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) ok = authenticator.check((await ask("Enter the 6-digit code now showing in Authy: ")).replace(/\s/g, ""), secret);
  if (!ok) return console.log("Code not accepted. Nothing saved. Run setup again.");

  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex"));
  fs.writeFileSync(FILE, JSON.stringify({ username, hash: bcrypt.hashSync(pw, 12), totp: secret,
    recovery: codes.map(c => bcrypt.hashSync(c, 10)), lastCode: "" }, null, 2), { mode: 0o600 });
  console.log("\nSaved. RECOVERY CODES (each works once; keep them somewhere safe and offline):");
  codes.forEach(c => console.log("   " + c.slice(0, 5) + "-" + c.slice(5)));
})();
