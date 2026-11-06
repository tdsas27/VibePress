/* Feedback: public form /feedback/, inbox + spam folder in admin. Guards: honeypot, fill-time, rate limit, optional Cloudflare Turnstile, link/duplicate filter. IPs are not stored. */
const express = require("express"), crypto = require("crypto"), rateLimit = require("express-rate-limit");
const store = require("./store"), UI = require("./ui");

module.exports = ({ page, h1, esc, hidden, verifyCsrf }) => {
  const FILE = "feedback.json";
  const TYPES = { bug: "Bug", idea: "Idea", praise: "Praise", tester: "Apply to be a tester", other: "Other" };
  const COLOR = { bug: "var(--red)", idea: "var(--blue)", praise: "var(--green)", tester: "var(--orange)", other: "var(--purple)" };
  const AGES = ["Under 18", "18-24", "25-34", "35-44", "45-54", "55+"];
  const SITEKEY = process.env.TURNSTILE_SITEKEY || "", SECRET = process.env.TURNSTILE_SECRET || "";
  const all = () => store.read(FILE);
  const date = iso => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const clip = (s, n) => String(s || "").trim().slice(0, n);

  const PLAT = [
    { k: "twitch", n: "Twitch", hosts: ["twitch.tv"], make: h => "https://twitch.tv/" + h.replace(/^@/, "") },
    { k: "itch", n: "itch.io", hosts: ["itch.io"], make: h => "https://" + h.replace(/^@/, "").toLowerCase() + ".itch.io" },
    { k: "youtube", n: "YouTube", hosts: ["youtube.com", "youtu.be"], make: h => "https://youtube.com/@" + h.replace(/^@/, "") },
    { k: "x", n: "X / Twitter", hosts: ["x.com", "twitter.com"], make: h => "https://x.com/" + h.replace(/^@/, "") },
    { k: "bluesky", n: "Bluesky", hosts: ["bsky.app"], make: h => { h = h.replace(/^@/, ""); return "https://bsky.app/profile/" + (h.includes(".") ? h : h + ".bsky.social"); } },
    { k: "discord", n: "Discord (username)", text: true },
    { k: "other", n: "Other link", any: true }
  ];
  const cleanLink = (p, raw) => {                                 // returns a safe https address (or text for Discord), or null if invalid
    if (p.text) return raw.replace(/[^\w.#-]/g, "").slice(0, 40) || null;
    const handle = !p.any && (p.k === "bluesky" ? !raw.includes("/") && !raw.includes("bsky.app") : /^@?[\w-]+$/.test(raw));
    if (handle) return /^@?[\w.-]+$/.test(raw) ? p.make(raw) : null;
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw), host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (!host.includes(".") || !["http:", "https:"].includes(u.protocol)) return null;
      if (!p.any && !p.hosts.some(h => host === h || host.endsWith("." + h))) return null;
      return u.href.slice(0, 200);
    } catch { return null; }
  };
  const chips = f => { const l = f.links || {}; const out = PLAT.filter(p => l[p.k]).map(p => p.text ? `<span class="tag">${esc(p.n)}: ${esc(l[p.k])}</span>` : `<a class="tag" href="${esc(l[p.k])}" target="_blank" rel="noopener noreferrer">${esc(p.n)}</a>`); return out.length ? `<div>${out.join("")}</div>` : ""; };

  const human = async req => {                                   // Cloudflare Turnstile (skipped if no keys are set)
    if (!SECRET) return true;
    try {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: SECRET, response: String(req.body["cf-turnstile-response"] || ""), remoteip: req.ip || "" }) });
      return !!(await r.json()).success;
    } catch { return false; }
  };

  const pub = express.Router();
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: "Too many messages from your network. Please try again later." });
  const form = (err, v = {}) => page("Feedback", `${h1("Feedback")}<p class="meta">Found a bug, have an idea, want to say thanks, or want to help test apps? Send it here.</p>${err ? `<p class="err">${esc(err)}</p>` : ""}
<form class="wide" method="post" action="/feedback/"><input type="hidden" name="t" value="${Date.now()}">
<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label>Type<select name="type" id="fb-type">${Object.entries(TYPES).map(([k, n]) => `<option value="${k}"${v.type === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>
<div id="tester-fields" style="display:grid;gap:.9rem"><p class="meta">Tester applications: all four fields below are required, and we only use them to contact you about testing. Testing is open to adults (18+).</p>
<label>App you want to test<input name="app" maxlength="80" value="${esc(v.app || "")}"></label>
<label>Systems (device and OS, e.g. Pixel 8, Android 15)<input name="systems" maxlength="120" value="${esc(v.systems || "")}"></label>
<label>Age range<select name="age"><option value="">Choose...</option>${AGES.map(a => `<option${v.age === a ? " selected" : ""}>${a}</option>`).join("")}</select></label>
<label>Location (country or region)<input name="location" maxlength="80" value="${esc(v.location || "")}"></label>
<p class="meta">Your links (optional): a username or a full address both work.</p>
${PLAT.map(p => `<label>${p.n}<input name="l_${p.k}" data-optional maxlength="120" value="${esc(v["l_" + p.k] || "")}"></label>`).join("")}</div>
<label>Message<textarea name="message" rows="6" required maxlength="2000">${esc(v.message || "")}</textarea></label>
<label>Name (optional)<input name="name" maxlength="60" value="${esc(v.name || "")}"></label>
<label>Email or contact (optional; required for tester applications)<input name="contact" maxlength="120" value="${esc(v.contact || "")}"></label>
${SITEKEY ? `<div class="cf-turnstile" data-sitekey="${esc(SITEKEY)}" data-theme="dark"></div>` : ""}
<button>Send</button></form><script src="/shared/feedback-form.js"></script>`,
    { index: true, head: UI + (SITEKEY ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : "") });
  const thanks = () => page("Thank you", `${h1("Thank you!")}<p>Your message was sent. <a href="/">Back to the site</a></p>`);

  pub.get("/", (req, res) => res.send(form()));
  pub.post("/", limiter, async (req, res) => {
    const b = req.body, list = all();
    if (b.website) return res.send(thanks());                                        // honeypot: pretend success to bots
    if (!(Date.now() - Number(b.t) >= 3000)) return res.status(400).send(form("Please try again.", b));
    if (!(await human(req))) return res.status(400).send(form("Please complete the human check and try again.", b));
    const type = TYPES[b.type] ? b.type : "other", message = clip(b.message, 2000), contact = clip(b.contact, 120);
    if (message.length < 5) return res.status(400).send(form("Please write a little more.", b));
    const rec = { id: crypto.randomBytes(6).toString("hex"), type, name: clip(b.name, 60), contact, message, created: new Date().toISOString(), status: "new" };
    if (type === "tester") {
      Object.assign(rec, { app: clip(b.app, 80), systems: clip(b.systems, 120), age: AGES.includes(b.age) ? b.age : "", location: clip(b.location, 80) });
      if (!rec.app || !rec.systems || !rec.age || !rec.location || !contact) return res.status(400).send(form("Tester applications need every field filled in, including your contact.", b));
      if (rec.age === "Under 18") return res.status(400).send(form("Thanks for your interest! Testing is open to adults (18+) right now.", b));
      rec.links = {};
      for (const p of PLAT) { const raw = clip(b["l_" + p.k], 120); if (!raw) continue; const c = cleanLink(p, raw); if (!c) return res.status(400).send(form("Please check your " + p.n + " link.", b)); rec.links[p.k] = c; }
    }
    if (list.length >= 2000) return res.status(503).send(form("The inbox is full right now. Please try again later."));
    const links = (message.match(/https?:\/\/|www\./gi) || []).length;
    if (links > 2 || list.some(f => f.message === message)) rec.status = "spam";        // kept in the spam folder for review
    list.push(rec); store.write(FILE, list);
    res.send(thanks());
  });

  const admin = express.Router();
  admin.get("/", (req, res) => {
    const spam = req.query.v === "spam", every = all().slice().reverse();
    const list = every.filter(f => spam ? f.status === "spam" : f.status !== "spam");
    const fresh = every.filter(f => f.status === "new").length, nSpam = every.filter(f => f.status === "spam").length;
    const btn = (f, status, label, cls = "") => `<form class="inline" method="post" action="/admin/feedback/mark">${hidden(req)}<input type="hidden" name="id" value="${f.id}"><input type="hidden" name="status" value="${status}"><input type="hidden" name="v" value="${spam ? "spam" : ""}"><button class="${cls}">${label}</button></form>`;
    res.send(page("Feedback inbox", `${h1("Feedback")}<p><a href="/admin/">&larr; Dashboard</a> &nbsp; <a href="/admin/feedback/">Inbox (${fresh} new)</a> &nbsp; <a href="/admin/feedback/?v=spam">Spam (${nSpam})</a> &nbsp; <a href="/admin/feedback/links">Tester links</a></p>${list.map(f => `<div class="card" style="--c:${COLOR[f.type]};margin:1rem 0">
<div class="row" style="border:0;padding:0"><span class="badge" style="background:${COLOR[f.type]}">${TYPES[f.type]}</span><strong>${esc(f.name || "Anonymous")}</strong><span class="meta">${date(f.created)}</span>${f.status === "new" ? '<span class="badge" style="background:var(--yellow)">new</span>' : ""}</div>
${f.contact ? `<p class="meta">Contact: ${esc(f.contact)}</p>` : ""}${f.type === "tester" ? `<p class="meta">App: ${esc(f.app)} | Systems: ${esc(f.systems)} | Age: ${esc(f.age)} | Location: ${esc(f.location)}</p>` : ""}${chips(f)}<p class="msg">${esc(f.message)}</p>
${spam ? btn(f, "new", "Not spam") : (f.status === "new" ? btn(f, "read", "Mark read") : btn(f, "new", "Mark unread")) + btn(f, "spam", "Spam")}
<form class="inline" method="post" action="/admin/feedback/delete">${hidden(req)}<input type="hidden" name="id" value="${f.id}"><input type="hidden" name="v" value="${spam ? "spam" : ""}"><button class="danger">Delete</button></form></div>`).join("") || '<p class="note">Nothing here.</p>'}`, { head: UI }));
  });
  admin.get("/links", (req, res) => {                              // every social link testers have added, grouped by platform
    const apps = all().filter(f => f.type === "tester" && f.status !== "spam" && f.links).reverse();
    const body = PLAT.map(p => { const rows = apps.filter(f => f.links[p.k]); if (!rows.length) return "";
      return `<h3 class="cat">${esc(p.n)} (${rows.length})</h3>${rows.map(f => `<div class="row"><strong>${esc(f.name || "Anonymous")}</strong>${p.text ? `<span>${esc(f.links[p.k])}</span>` : `<a href="${esc(f.links[p.k])}" target="_blank" rel="noopener noreferrer">${esc(f.links[p.k])}</a>`}<span class="meta">${esc(f.contact)} | ${esc(f.app)} | ${date(f.created)}</span></div>`).join("")}`; }).join("");
    res.send(page("Tester links", `${h1("Tester links")}<p><a href="/admin/feedback/">&larr; Feedback inbox</a></p>${body || '<p class="note">No tester links yet.</p>'}`, { head: UI }));
  });
  const back = req => "/admin/feedback/" + (req.body.v === "spam" ? "?v=spam" : "");
  admin.post("/mark", verifyCsrf, (req, res) => {
    const id = String(req.body.id || ""), st = ["new", "read", "spam"].includes(req.body.status) ? req.body.status : "read";
    store.write(FILE, all().map(f => f.id === id ? { ...f, status: st } : f)); res.redirect(back(req));
  });
  admin.post("/delete", verifyCsrf, (req, res) => { const id = String(req.body.id || ""); store.write(FILE, all().filter(f => f.id !== id)); res.redirect(back(req)); });
  return { pub, admin };
};
