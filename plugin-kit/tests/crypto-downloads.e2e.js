// End-to-end test of Crypto Downloads on the real plugin system: package, install review, private files, settings page, sandboxed server code,
// settings/orders/grants/download route. Only the blockchain network is faked.   node plugin-kit/tests/crypto-downloads.e2e.js
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto"), { execFileSync } = require("child_process");
const { load, makeCounter } = require("./harness");
const T = makeCounter(), ok = T.ok;
const KIT = path.join(__dirname, "..");
const BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", ETH = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", TON = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const ID = "crypto-downloads";

(async () => {
  const H = load(), { tmp, A, P, registry, host, pdata } = H;
  const chain = { btc: [], eth: { items: [] }, ton: { transactions: [] }, down: false, requests: [] };
  host.configure({ fetch: async (url, hosts, ms) => {                      // stands in for the internet; the host's permission check has already run
    const u = new URL(url); chain.requests.push(url);
    if (!hosts.includes(u.hostname)) throw new Error("fake chain: host not permitted");
    if (chain.down) throw new Error("network down");
    if (u.hostname === "mempool.space" && /\/txs$/.test(u.pathname)) return { status: 200, text: JSON.stringify(chain.btc) };
    if (u.hostname === "eth.blockscout.com") return { status: 200, text: JSON.stringify(chain.eth) };
    if (u.hostname === "tonapi.io") return { status: 200, text: JSON.stringify(chain.ton) };
    if (u.hostname === "example.com") return { status: 200, text: "hello from example" };
    return { status: 404, text: "{}" };
  } });
  const spec = () => registry.get(ID).collections.orders, order = code => pdata.srv.find(ID, "orders", spec(), "code", code);
  const fresh = coin => { pdata.kv.delete(ID, "c:" + coin); pdata.kv.delete(ID, "l:" + coin); };   // forget the plugin's 15 second lookup cache
  const upload = async file => A("POST", "/upload", { file: { buffer: file } });

  console.log("\n-- package, review and install --");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vp-pack-"));
  execFileSync(process.execPath, [path.join(KIT, "vp-plugin.js"), "pack", path.join(KIT, "examples", ID)], { cwd: out, stdio: "ignore" });
  const pk = path.join(out, ID + "-1.0.2.vpplugin"); ok("the kit packs the plugin", fs.existsSync(pk));
  let r = await upload(fs.readFileSync(pk)); ok("upload goes to review", r.loc && r.loc.includes("review"), r.body);
  const tok = r.loc.split("t=")[1];
  r = await A("GET", "/review", { query: { t: tok } });
  ok("review lists every permission in plain English", /private files/.test(r.body) && /mempool\.space/.test(r.body) && /tonapi\.io/.test(r.body) && /eth\.blockscout\.com/.test(r.body));
  ok("review says there is a settings page and that requests may take up to 10 seconds", /settings page/.test(r.body) && /up to 10 seconds/.test(r.body) && /Server code/.test(r.body));
  const perms = {}; for (let i = 0; i < 6; i++) perms["p" + i] = "1";
  r = await A("POST", "/install", { body: { t: tok, ...perms } }); ok("install is refused without the trust tick", r.code === 400);
  r = await A("POST", "/install", { body: { t: tok, ...perms, trust: "1" } }); ok("installed", /^\/admin\/plugins\/\?done=installed/.test(r.loc), r.body);
  ok("only the web files are published, never the server code or settings", fs.existsSync(tmp + "/site/x/" + ID + "/index.html") && fs.existsSync(tmp + "/site/x/" + ID + "/qr.js") && !fs.existsSync(tmp + "/site/x/" + ID + "/server.js") && !fs.existsSync(tmp + "/site/x/" + ID + "/plugin.json"));
  r = await A("GET", "/"); ok("the plugin card says it needs setup and offers Settings and Files", /Needs setup/.test(r.body) && /settings\?id=crypto-downloads/.test(r.body) && /files\?id=crypto-downloads/.test(r.body));
  r = await P("GET", "/" + ID + "/r/catalog"); ok("before setup the shop says it is not configured", JSON.parse(r.body).configured === false, r.body);

  console.log("\n-- the setup check, before anything is set up --");
  r = await P("GET", "/" + ID + "/r/__status"); ok("visitors cannot reach routes that start with __", r.code === 404 && !/items/.test(r.body), r.body);
  r = await A("GET", "/diagnose", { query: { id: ID } }); ok("the owner's Setup check page lists what is missing", /No files uploaded yet/.test(r.body) && /No wallet address entered/.test(r.body) && /NOT open yet/.test(r.body) && /Open Files on this plugin/.test(r.body), r.body.slice(0, 400));
  r = await A("GET", "/"); ok("the plugin card offers the Setup check", /diagnose\?id=crypto-downloads/.test(r.body));
  r = await A("GET", "/settings", { query: { id: ID } }); ok("the Settings page shows the Setup check on top", /Setup check/.test(r.body) && /No wallet address entered/.test(r.body));

  console.log("\n-- private files --");
  const content = crypto.randomBytes(5000), srcFile = path.join(tmp, "upload.tmp"); fs.writeFileSync(srcFile, content);
  r = await A("POST", "/files/upload", { body: { id: ID }, file: { path: srcFile, originalname: "../../My Ebook.pdf" } });
  ok("upload succeeds", r.loc === "/admin/plugins/files?id=" + ID + "&done=1", r.body);
  const f = pdata.files.list(ID)[0];
  ok("name is cleaned, size and SHA-256 recorded", f.name === "My Ebook.pdf" && f.size === 5000 && f.sha256 === crypto.createHash("sha256").update(content).digest("hex"), JSON.stringify(f));
  const stored = tmp + "/data/plugin-files/" + ID + "/" + f.id;
  ok("the file is stored privately: outside the web folder, owner-only permissions", fs.existsSync(stored) && !stored.startsWith(tmp + "/site") && (fs.statSync(stored).mode & 0o077) === 0 && !fs.readdirSync(tmp + "/site/x/" + ID).some(n => n.includes(f.id)));
  r = await A("GET", "/files", { query: { id: ID } }); ok("files page lists it with its checksum", /My Ebook\.pdf/.test(r.body) && r.body.includes(f.sha256));
  r = await A("POST", "/files/upload", { body: { id: "no-such" }, file: { path: srcFile, originalname: "x" } }); ok("uploading for an unknown plugin is refused and cleans up", r.loc === "/admin/plugins/");
  const empty = path.join(tmp, "empty.tmp"); fs.writeFileSync(empty, ""); r = await A("POST", "/files/upload", { body: { id: ID }, file: { path: empty, originalname: "e" } }); ok("an empty file is refused with a message", r.code === 400 && /empty/.test(r.body));

  console.log("\n-- settings page --");
  r = await A("GET", "/settings", { query: { id: ID } });
  ok("settings page shows every field, the file as a choice, and an empty row to add a product", /Your Bitcoin address/.test(r.body) && /Price in TON/.test(r.body) && r.body.includes("My Ebook.pdf") && /\(new\)/.test(r.body) && /value="60"/.test(r.body));
  const row = { l_products_n: "1", l_products_0__id: "", l_products_0_title: "The Ebook", l_products_0_description: "A great read", l_products_0_file: f.id, l_products_0_btc: "0.0005", l_products_0_eth: "0.01", l_products_0_ton: "5" };
  const good = { id: ID, f_btc_address: BTC, f_eth_address: ETH, f_ton_address: TON, f_btc_confirmations: "1", f_eth_confirmations: "12", f_order_minutes: "60", f_max_downloads: "5", f_access_days: "30", ...row };
  const bad = (over, re, name) => A("POST", "/settings", { body: { ...good, ...over } }).then(x => ok(name, x.code === 400 && re.test(x.body) && !Object.keys(pdata.settings.get(ID).values).length, x.code + " " + x.body.slice(0, 200)));
  await bad({ f_btc_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb" }, /valid BTC address/, "a Bitcoin address with a typo is refused and nothing is saved");
  await bad({ f_eth_address: "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" }, /valid ETH address/, "an Ethereum address with a wrong checksum is refused");
  await bad({ f_ton_address: TON.slice(0, 20) + "B" + TON.slice(21) }, /valid TON address/, "a TON address with a typo is refused");
  await bad({ l_products_0_btc: "1e5" }, /Price in BTC must be a plain number/, "a price that is not a plain number is refused");
  await bad({ l_products_0_file: "aaaaaaaaaaaa" }, /choose one of your uploaded files/, "a file that does not exist is refused");
  await bad({ f_btc_confirmations: "9" }, /from 1 to 6/, "a number outside its range is refused");
  await bad({ l_products_0_title: "" }, /Title is required/, "a missing required product title is refused");
  const wrong = { ...good, f_btc_address: "", f_eth_address: "", l_products_0_btc: "0.0005", l_products_0_eth: "", l_products_0_ton: "" };
  await A("POST", "/settings", { body: wrong }); r = await A("GET", "/diagnose", { query: { id: ID } });
  ok("a BTC price with no Bitcoin address (the classic mistake) is explained, and the shop is still closed", /you have not entered a Bitcoin address/.test(r.body) && /NOT open yet/.test(r.body), r.body.slice(0, 500));
  r = await P("GET", "/" + ID + "/r/catalog"); ok("and visitors see the shop as not open", JSON.parse(r.body).configured === false);
  pdata.settings.set(ID, {}, { products: [] });
  r = await A("POST", "/settings", { body: good }); ok("valid settings are saved", r.loc === "/admin/plugins/settings?id=" + ID + "&saved=1", r.body);
  const saved = pdata.settings.get(ID); ok("stored with normalised addresses and an id for the product", saved.values.btc_address === BTC && saved.lists.products.length === 1 && /^[a-f0-9]{10}$/.test(saved.lists.products[0].id));
  const pid = saved.lists.products[0].id;
  r = await A("GET", "/settings", { query: { id: ID, saved: "1" } }); ok("the page shows the saved values and confirms the address checks", r.body.includes(BTC) && /checksum look right/.test(r.body) && r.body.includes("The Ebook"));
  const row2 = { l_products_n: "2", l_products_0__id: pid, l_products_0_title: "The Ebook (2nd ed.)", l_products_0_file: f.id, l_products_0_btc: "0.0005", l_products_1__id: "", l_products_1_title: "Bundle", l_products_1_file: f.id, l_products_1_ton: "20" };
  r = await A("POST", "/settings", { body: { ...good, ...row2 } }); const s2 = pdata.settings.get(ID).lists.products;
  ok("editing keeps a product's id and adds a new one", s2.length === 2 && s2[0].id === pid && s2[0].title === "The Ebook (2nd ed.)" && s2[1].id !== pid && s2[1].ton === "20");
  r = await A("POST", "/settings", { body: { ...good, ...row2, l_products_1__del: "1", l_products_n: "3", l_products_2__id: "", l_products_2_title: "", l_products_2_btc: "" } });
  ok("ticking Remove deletes a product; an untouched blank row is ignored", pdata.settings.get(ID).lists.products.length === 1 && pdata.settings.get(ID).lists.products[0].id === pid);
  await A("POST", "/settings", { body: { ...good, l_products_n: "1", l_products_0__id: pid, l_products_0_title: "The Ebook", l_products_0_file: f.id, l_products_0_btc: "0.0005", l_products_0_eth: "0.01", l_products_0_ton: "5" } });

  r = await A("GET", "/diagnose", { query: { id: ID } }); ok("after a correct setup the check is green and says the shop is open", /on sale for BTC 0\.0005, ETH 0\.01, TON 5/.test(r.body) && /The shop is open with 1 product/.test(r.body) && !/&#9888;/.test(r.body), r.body.slice(0, 500));

  console.log("\n-- the shop, through the real sandbox --");
  r = await P("GET", "/" + ID + "/r/catalog"); let cat = JSON.parse(r.body);
  ok("catalog works and shows prices, but no addresses, file ids or paths", cat.configured && cat.products[0].title === "The Ebook" && cat.products[0].prices.eth === "0.01" && !r.body.includes(BTC) && !r.body.includes(f.id) && !r.body.includes("plugin-files"), r.body);
  r = await P("POST", "/" + ID + "/r/order", { body: { product: pid, coin: "btc" }, headers: { "x-real-ip": "7.7.7.7" } }); let o = JSON.parse(r.body);
  ok("an order comes back with the exact amount, the address and a payment link", r.code === 200 && o.address === BTC && o.uri.startsWith("bitcoin:" + BTC + "?amount=" + o.amount) && o.amount !== "0.0005", r.body);
  let st = JSON.parse((await P("GET", "/" + ID + "/r/status", { query: { code: o.code } })).body); ok("status: pending while nothing has been paid", st.status === "pending" && st.paid === false, JSON.stringify(st));
  r = await P("POST", "/" + ID + "/r/claim", { body: { code: o.code } }); ok("claim before payment is refused (402)", r.code === 402);
  const rec = order(o.code);
  chain.btc = [{ txid: "f".repeat(64), status: { confirmed: true, block_height: 900000, block_time: Math.floor(Date.now() / 1000) }, vout: [{ scriptpubkey_address: BTC, value: Number(rec.units) }] }];
  fresh("btc"); pdata.srv.update(ID, "orders", spec(), rec.id, { checked: 0 });
  st = JSON.parse((await P("GET", "/" + ID + "/r/status", { query: { code: o.code } })).body);
  ok("after the payment appears on the (fake) blockchain the order is paid", st.paid === true && st.status === "paid", JSON.stringify(st));
  ok("the owner can see it: order is marked paid with the transaction id", order(o.code).approved === true && order(o.code).txid === "f".repeat(64));
  r = await A("GET", "/entries", { query: { id: ID, c: "orders" } }); ok("admin Orders page shows 'Paid' and 'Mark as unpaid' (custom wording)", /Paid/.test(r.body) && /Mark as unpaid/.test(r.body) && /The Ebook/.test(r.body) && /f{20}/.test(r.body));

  console.log("\n-- downloading --");
  r = await P("POST", "/" + ID + "/r/claim", { body: { code: o.code } }); const cl = JSON.parse(r.body);
  ok("claim returns a link, the file name and its checksum", r.code === 200 && /^\/x-api\/crypto-downloads\/dl\/[A-Za-z0-9_-]{20,}$/.test(cl.url) && cl.name === "My Ebook.pdf" && cl.sha256 === f.sha256 && cl.claimsLeft === 4, r.body);
  const token = cl.url.split("/").pop();
  ok("only a hash of the token is stored, never the token", !fs.readFileSync(tmp + "/data/plugin-data/" + ID + ".json", "utf8").includes(token));
  r = await P("GET", "/" + ID + "/dl/" + token); ok("the link serves the private file as an attachment with its real name", r.dl && r.dl[0] === stored && r.dl[1] === "My Ebook.pdf" && r.hdr["Cache-Control"] === "private, no-store" && r.hdr["Content-Security-Policy"] === "sandbox", JSON.stringify([r.dl, r.hdr]));
  await P("GET", "/" + ID + "/dl/" + token); await P("GET", "/" + ID + "/dl/" + token);
  r = await P("GET", "/" + ID + "/dl/" + token); ok("after 3 uses the link is dead (410)", r.code === 410 && !r.dl);
  r = await P("GET", "/" + ID + "/dl/" + "A".repeat(32)); ok("a made-up token is refused (410)", r.code === 410 && !r.dl);
  r = await P("GET", "/" + ID + "/dl/short"); ok("a malformed token is refused (404)", r.code === 404);
  const c2 = JSON.parse((await P("POST", "/" + ID + "/r/claim", { body: { code: o.code } })).body); const t2 = c2.url.split("/").pop();
  H.pfiles.remove(ID, f.id); r = await P("GET", "/" + ID + "/dl/" + t2);
  ok("deleting the file from the admin kills open links to it", r.code === 410 && !r.dl && !fs.existsSync(stored));
  r = await P("POST", "/" + ID + "/r/claim", { body: { code: o.code } }); ok("and claims then say the file is gone (410)", r.code === 410);
  fs.writeFileSync(srcFile, content); await A("POST", "/files/upload", { body: { id: ID }, file: { path: srcFile, originalname: "My Ebook.pdf" } }); const f2 = pdata.files.list(ID)[0];
  const cur = pdata.settings.get(ID); cur.lists.products[0].file = f2.id; pdata.settings.set(ID, cur.values, cur.lists);
  const rec2 = order(o.code); pdata.srv.update(ID, "orders", spec(), rec2.id, { file: f2.id, claims: 0 });
  for (let i = 0; i < 5; i++) await P("POST", "/" + ID + "/r/claim", { body: { code: o.code } });
  r = await P("POST", "/" + ID + "/r/claim", { body: { code: o.code } }); ok("downloads per purchase are limited (default 5, then 429)", r.code === 429, r.body);

  console.log("\n-- paying by hand, Ethereum, TON --");
  let o2 = JSON.parse((await P("POST", "/" + ID + "/r/order", { body: { product: pid, coin: "eth" }, headers: { "x-real-ip": "7.7.7.8" } })).body);
  r = await A("GET", "/entries", { query: { id: ID, c: "orders" } }); const eid = (r.body.match(new RegExp("The Ebook[\\s\\S]*?name=\"e\" value=\"([a-f0-9]{10})\"")) || [])[1];
  const unpaid = pdata.srv.find(ID, "orders", spec(), "code", o2.code);
  await A("POST", "/entry", { body: { id: ID, c: "orders", e: unpaid.id, do: "approve" } });
  st = JSON.parse((await P("GET", "/" + ID + "/r/status", { query: { code: o2.code } })).body); ok("the owner can mark an order paid by hand, and the buyer's page follows", st.paid === true && st.status === "paid", JSON.stringify(st));
  r = await P("POST", "/" + ID + "/r/claim", { body: { code: o2.code } }); ok("and that buyer can download", r.code === 200);
  await A("POST", "/entry", { body: { id: ID, c: "orders", e: unpaid.id, do: "hide" } }); r = await P("POST", "/" + ID + "/r/claim", { body: { code: o2.code } }); ok("marking it unpaid again withdraws access", r.code === 402);

  let o3 = JSON.parse((await P("POST", "/" + ID + "/r/order", { body: { product: pid, coin: "eth" }, headers: { "x-real-ip": "7.7.7.9" } })).body); const r3 = order(o3.code);
  chain.eth = { items: [{ hash: "0x" + "a".repeat(64), to: { hash: ETH.toLowerCase() }, value: r3.units, status: "ok", confirmations: 15, timestamp: new Date().toISOString() }] };
  fresh("eth"); pdata.srv.update(ID, "orders", spec(), r3.id, { checked: 0 }); st = JSON.parse((await P("GET", "/" + ID + "/r/status", { query: { code: o3.code } })).body);
  ok("an Ethereum payment with 15 confirmations is recognised", st.paid === true, JSON.stringify(st));
  let o4 = JSON.parse((await P("POST", "/" + ID + "/r/order", { body: { product: pid, coin: "ton" }, headers: { "x-real-ip": "7.7.7.10" } })).body); const r4 = order(o4.code);
  chain.ton = { transactions: [{ hash: "h".repeat(64), utime: Math.floor(Date.now() / 1000), success: true, in_msg: { value: 5000000000, decoded_body: { text: r4.memo } } }] };
  fresh("ton"); pdata.srv.update(ID, "orders", spec(), r4.id, { checked: 0 }); st = JSON.parse((await P("GET", "/" + ID + "/r/status", { query: { code: o4.code } })).body);
  ok("a TON payment carrying the order's comment is recognised", st.paid === true && st.memo === r4.memo, JSON.stringify(st));
  chain.down = true; fresh("btc"); let o5 = JSON.parse((await P("POST", "/" + ID + "/r/order", { body: { product: pid, coin: "btc" }, headers: { "x-real-ip": "7.7.7.11" } })).body);
  r = await P("GET", "/" + ID + "/r/status", { query: { code: o5.code } }); ok("with the blockchain APIs down the buyer sees a normal 'pending' (no crash, no error)", r.code === 200 && JSON.parse(r.body).status === "pending");
  chain.down = false; ok("the plugin is still healthy after provider failures", host.status(ID).running === true);

  console.log("\n-- what a plugin may and may not do (the platform side) --");
  const probe = (id, extra) => {
    const dir = path.join(tmp, "probe-" + id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "server.js"), `module.exports = function (vp) {
      const t = async f => { try { return { r: "ALLOWED", v: await f() }; } catch (e) { return { r: "blocked", why: String(e.message).slice(0, 90) }; } };
      vp.route("GET", "/files", async () => ({ json: { list: await t(() => vp.files.list()), grant: await t(() => vp.files.grant("aaaaaaaaaaaa")) } }));
      vp.route("GET", "/data", async () => ({ json: { other: await t(() => vp.data.list("nothing")), add: await t(() => vp.data.add("nothing", {})) } }));
      vp.route("GET", "/fetch", async req => ({ json: await t(async () => (await vp.fetch(req.query.u)).text) }));
      vp.route("GET", "/settings", async () => ({ json: await t(() => vp.settings.get()) }));
      vp.route("GET", "/slow", async () => { await new Promise(r => setTimeout(r, 3500)); return { json: { done: true } }; });
    };`);
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(Object.assign({ id, name: id, version: "1.0.0", author: "t", description: "probe", vibepress: "0.3.0", server: "server.js", permissions: ["net:example.com"] }, extra)));
    const m = H.manifest.validate(JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8")), "0.3.0"); if (!m.ok) throw new Error(m.errors.join());
    registry.install({ base: dir, manifest: m.manifest, hash: "x", zipPath: path.join(dir, "plugin.json"), granted: m.manifest.permissions });
  };
  probe("probe-plain", {}); probe("probe-slow", { timeout: 6 });
  const get = async (id, p, q) => JSON.parse((await P("GET", "/" + id + "/r" + p, { query: q || {} })).body);
  let x = await get("probe-plain", "/files"); ok("without files:private a plugin cannot list or hand out files", x.list.r === "blocked" && x.grant.r === "blocked" && /files:private/.test(x.list.why), JSON.stringify(x));
  x = await get("probe-plain", "/data"); ok("a plugin can only use collections it declared", x.other.r === "blocked" && x.add.r === "blocked" && /no collection/.test(x.other.why), JSON.stringify(x));
  x = await get("probe-plain", "/fetch", { u: "https://example.com/" }); ok("fetch works for a declared host", x.r === "ALLOWED" && x.v === "hello from example", JSON.stringify(x));
  x = await get("probe-plain", "/fetch", { u: "https://evil.example.org/" }); ok("fetch to any other host is refused, even when the network is faked", x.r === "blocked" && /did not ask for permission/.test(x.why), JSON.stringify(x));
  x = await get("probe-plain", "/fetch", { u: "http://example.com/" }); ok("fetch over plain http is refused", x.r === "blocked" && /https/.test(x.why), JSON.stringify(x));
  x = await get("probe-plain", "/settings"); ok("a plugin without settings just sees empty settings", x.r === "ALLOWED" && JSON.stringify(x.v) === JSON.stringify({ values: {}, lists: {} }), JSON.stringify(x));
  let t0 = Date.now(); r = await P("GET", "/probe-plain/r/slow"); ok("a plugin with the default 3 second limit is cut off at 3 seconds (504)", r.code === 504 && Date.now() - t0 < 4200, r.code + " " + (Date.now() - t0));
  t0 = Date.now(); r = await P("GET", "/probe-slow/r/slow"); ok("a plugin that declared timeout 6 may take 3.5 seconds", r.code === 200 && JSON.parse(r.body).done === true, r.code + " " + r.body);
  ok("downloads for a plugin without files:private are not served", (await P("GET", "/probe-plain/dl/" + "A".repeat(30))).code === 404);

  r = await A("GET", "/diagnose", { query: { id: "probe-plain" } }); ok("a plugin without a setup check says so", /no setup check/.test(r.body));

  console.log("\n-- removing --");
  const filesDir = tmp + "/data/plugin-files/" + ID;
  await A("POST", "/remove", { body: { id: ID, keep: "1" } }); ok("removing with 'keep my data' keeps orders, settings and private files", fs.existsSync(filesDir) && fs.existsSync(tmp + "/data/plugin-data/" + ID + ".json") && !fs.existsSync(tmp + "/site/x/" + ID) && !registry.get(ID));
  r = await upload(fs.readFileSync(pk)); r = await A("POST", "/install", { body: { t: r.loc.split("t=")[1], ...perms, trust: "1" } });
  ok("installing it again brings the old settings and files straight back", /^\/admin\/plugins\/\?done=installed/.test(r.loc) && pdata.settings.get(ID).values.btc_address === BTC && pdata.files.list(ID).length === 1 && fs.existsSync(filesDir), r.body);
  r = await P("GET", "/" + ID + "/r/catalog"); ok("and the shop works again immediately", JSON.parse(r.body).configured === true);
  await A("POST", "/remove", { body: { id: ID } }); ok("removing without 'keep' deletes orders, settings and private files too", !fs.existsSync(filesDir) && !fs.existsSync(tmp + "/data/plugin-data/" + ID + ".json") && !registry.get(ID));
  H.cleanup(); process.exit(T.done());
})().catch(e => { console.error("CRASH", e); process.exit(1); });
