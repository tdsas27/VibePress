/* Traffic monitor: summaries built from the Nginx access log (no tracking scripts, no cookies, no visitor profiles).
   Shows visitors, page views, top pages, where visitors come from, countries, devices, downloads, and social post campaigns. Times are UTC. */
const fs = require("fs"), path = require("path"), zlib = require("zlib"), express = require("express");
const store = require("./store"), UI = require("./ui");

module.exports = ({ page, h1, esc, A, SITE_URL, country }) => {
  const LOG = process.env.NGINX_ACCESS_LOG || "/var/log/nginx/access.log", OWN = (() => { try { return new URL(SITE_URL).hostname; } catch { return ""; } })();
  const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"/;
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parseTime = s => { const m = /^(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+) ([+-])(\d\d)(\d\d)$/.exec(s); if (!m) return 0;
    return Date.UTC(+m[3], MON[m[2]], +m[1], +m[4], +m[5], +m[6]) - (m[7] === "-" ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60000; };
  const BOT = /bot|crawl|spider|slurp|preview|headless|python|curl|wget|http-?client|monitor|uptime|scan|go-http|java\/|axios|node-fetch/i;
  const STATIC = /\.(css|js|map|webp|png|jpe?g|gif|svg|ico|woff2?|ttf|json|xml|txt|mp4|webm|apk|aab|zip|exe|msi|dmg|pkg|deb|rpm|appimage|gz|ipa|7z)(\?|$)/i;
  const SEARCH = { google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", yahoo: "Yahoo", brave: "Brave Search", ecosia: "Ecosia", yandex: "Yandex", kagi: "Kagi", baidu: "Baidu", startpage: "Startpage" };
  const SOCIAL = { "t.co": "X / Twitter", "twitter.com": "X / Twitter", "x.com": "X / Twitter", facebook: "Facebook", "fb.com": "Facebook", instagram: "Instagram", reddit: "Reddit", "youtube.com": "YouTube", "youtu.be": "YouTube",
    twitch: "Twitch", "bsky.app": "Bluesky", mastodon: "Mastodon", tiktok: "TikTok", discord: "Discord", pinterest: "Pinterest", linkedin: "LinkedIn", "lnkd.in": "LinkedIn", threads: "Threads", "itch.io": "itch.io", github: "GitHub" };
  const UTM = { x: "X / Twitter", bluesky: "Bluesky", mastodon: "Mastodon", threads: "Threads", facebook: "Facebook", linkedin: "LinkedIn", reddit: "Reddit", instagram: "Instagram", discord: "Discord", telegram: "Telegram", whatsapp: "WhatsApp" };
  const dev = u => /ipad|tablet/i.test(u) ? "Tablet" : /mobi|android|iphone/i.test(u) ? "Mobile" : "Desktop";
  const brw = u => /edg\//i.test(u) ? "Edge" : /opr\/|opera/i.test(u) ? "Opera" : /firefox|fxios/i.test(u) ? "Firefox" : /chrome|crios/i.test(u) ? "Chrome" : /safari/i.test(u) ? "Safari" : "Other";
  const sys = u => /windows/i.test(u) ? "Windows" : /iphone|ipad|ios/i.test(u) ? "iOS" : /android/i.test(u) ? "Android" : /mac os|macintosh/i.test(u) ? "macOS" : /linux|x11/i.test(u) ? "Linux" : "Other";

  let cache = { at: 0, rows: null };
  const load = () => {
    if (cache.rows && Date.now() - cache.at < 60000) return cache.rows;
    const dir = path.dirname(LOG), base = path.basename(LOG); let names;
    try { names = fs.readdirSync(dir).filter(n => n === base || n.startsWith(base + ".")); } catch { return null; }
    const rows = []; let readable = 0;
    for (const n of names) {
      let b; try { b = fs.readFileSync(path.join(dir, n)); if (n.endsWith(".gz")) b = zlib.gunzipSync(b); } catch { continue; }
      readable++; if (b.length > 64 * 1048576) b = b.subarray(b.length - 64 * 1048576);
      for (const line of b.toString("utf8").split("\n")) { const m = LINE.exec(line); if (m) rows.push({ ip: m[1], t: parseTime(m[2]), method: m[3], path: m[4], status: +m[5], ref: m[6], ua: m[7] }); }
    }
    if (!readable) return null;
    cache = { at: Date.now(), rows }; return rows;
  };
  const source = r => {                                        // where did this page view come from?
    const q = /[?&]utm_source=([\w.-]+)/.exec(r.path);
    if (q) return { cat: "Social", name: UTM[q[1].toLowerCase()] || q[1], campaign: ((/[?&]utm_campaign=([\w.-]+)/.exec(r.path) || [])[1] || "") };
    if (!r.ref || r.ref === "-") return { cat: "Direct", name: "Direct or unknown" };
    let host = ""; try { host = new URL(r.ref).hostname.replace(/^www\./, ""); } catch { return { cat: "Direct", name: "Direct or unknown" }; }
    if (host === OWN) return null;                             // moving around the site itself
    for (const k of Object.keys(SEARCH)) if (host.includes(k)) return { cat: "Search", name: SEARCH[k] };
    for (const k of Object.keys(SOCIAL)) if (host === k || host.endsWith("." + k) || host.includes(k + ".")) return { cat: "Social", name: SOCIAL[k] };
    return { cat: "Other sites", name: host };
  };
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const inc = (o, k, d = 1) => { o[k] = (o[k] || 0) + d; };

  const build = days => {
    const rows = load(); if (!rows) return null;
    const now = Date.now(), from = now - days * 864e5, R = { pv: 0, bots: 0, downloads: 0, now: new Set(), visitors: new Set(), pages: {}, cats: {}, srcs: {}, camps: {}, days: {}, countries: {}, devs: {}, brs: {}, oss: {}, dls: {} };
    const seen = new Set();
    for (const r of rows) {
      if (r.t < from) continue;
      if (BOT.test(r.ua) || r.ua === "-") { R.bots++; continue; }
      if (r.method !== "GET") continue;
      if (r.path.startsWith("/get/") && r.status === 302) { R.downloads++; inc(R.dls, r.path.split("?")[0]); continue; }
      const p = r.path.split("?")[0];
      if (!(r.status === 200 || r.status === 304) || STATIC.test(r.path) || p.startsWith(A) || p.startsWith("/go/") || p.startsWith("/shared/")) continue;
      R.pv++; inc(R.pages, p);
      const day = new Date(r.t).toISOString().slice(0, 10), vid = r.ip + "|" + r.ua.slice(0, 80) + "|" + day;
      inc(R.days, day);
      if (r.t > now - 15 * 60000) R.now.add(r.ip + r.ua.slice(0, 40));
      const s = source(r);
      if (s) { inc(R.cats, s.cat); inc(R.srcs, s.cat + ": " + s.name); if (s.campaign) inc(R.camps, s.name + " / " + s.campaign); }
      if (!seen.has(vid)) {
        seen.add(vid); R.visitors.add(vid);
        inc(R.devs, dev(r.ua)); inc(R.brs, brw(r.ua)); inc(R.oss, sys(r.ua));
        const c = country ? country(r.ip) : ""; if (c) inc(R.countries, c);
      }
    }
    return R;
  };

  const bars = (list, total, color = "var(--blue)") => list.map(([n, c]) => `<div class="row" style="gap:.4rem 1rem"><span style="flex:1;min-width:9rem;word-break:break-all">${esc(n)}</span><span class="meta" style="min-width:3.5rem;text-align:right">${c}</span><span style="flex:2;min-width:8rem;display:block;height:.7rem;background:var(--card);border-radius:1rem"><span style="display:block;height:100%;width:${Math.max(2, Math.round(100 * c / Math.max(total, 1)))}%;background:${color};border-radius:1rem"></span></span></div>`).join("") || '<p class="meta">Nothing yet.</p>';
  const stat = (n, label, c) => `<div class="card" style="--c:${c};text-align:center"><div style="font-size:2rem;font-weight:700">${n}</div><p>${label}</p></div>`;

  const admin = express.Router();
  admin.get("/", (req, res) => {
    const days = [1, 7, 14].includes(+req.query.days) ? +req.query.days : 7, R = build(days);
    const tabs = [1, 7, 14].map(d => d === days ? `<strong>${d === 1 ? "24 hours" : d + " days"}</strong>` : `<a href="/admin/traffic/?days=${d}">${d === 1 ? "24 hours" : d + " days"}</a>`).join(" &nbsp; ");
    if (!R) return res.send(page("Traffic", `${h1("Traffic")}<p><a href="/admin/">&larr; Dashboard</a></p><p class="note">The Nginx access log could not be read. Run <code>sudo usermod -aG adm deploy</code>, log out and back in, then restart the app (see the cheat sheet, firewall section).</p>`, { head: UI }));
    const dayKeys = Object.keys(R.days).sort(), max = Math.max(1, ...Object.values(R.days));
    const chart = days > 1 && dayKeys.length ? `<div style="display:flex;gap:4px;align-items:flex-end;height:120px;margin:.5rem 0">${dayKeys.map(d => `<div title="${d}: ${R.days[d]} page views" style="flex:1;height:${Math.max(2, Math.round(100 * R.days[d] / max))}%;background:var(--purple);border-radius:4px 4px 0 0"></div>`).join("")}</div><div style="display:flex;gap:4px;font-size:.7rem;color:var(--muted)">${dayKeys.map(d => `<span style="flex:1;text-align:center">${d.slice(5)}</span>`).join("")}</div>` : "";
    const tot = o => Object.values(o).reduce((a, b) => a + b, 0);
    res.send(page("Traffic", `${h1("Traffic")}<p><a href="/admin/">&larr; Dashboard</a> &nbsp; Showing the last ${tabs}</p>
<p class="meta">Built from the server's access log, so there are no tracking scripts or cookies. Browsers that block referrers show as "Direct". Search bots and scanners are filtered out. Times are UTC. The log keeps about two weeks.</p>
<ul class="grid">${[["Visitors", R.visitors.size, "var(--green)"], ["Page views", R.pv, "var(--blue)"], ["Downloads", R.downloads, "var(--orange)"], ["On the site now (15 min)", R.now.size, "var(--purple)"], ["Bots filtered", R.bots, "var(--red)"]].map(([l, n, c]) => `<li>${stat(n, l, c)}</li>`).join("")}</ul>
${chart ? `<h3 class="cat">Page views per day</h3>${chart}` : ""}
<h3 class="cat">Where visitors come from</h3>${bars(top(R.cats, 6), tot(R.cats), "var(--green)")}
<h3 class="cat">Top sources</h3>${bars(top(R.srcs, 12), tot(R.srcs))}
${Object.keys(R.camps).length ? `<h3 class="cat">Social post campaigns</h3>${bars(top(R.camps, 10), tot(R.camps), "var(--orange)")}` : ""}
<h3 class="cat">Top pages</h3>${bars(top(R.pages, 15), R.pv, "var(--purple)")}
${Object.keys(R.countries).length ? `<h3 class="cat">Countries</h3>${bars(top(R.countries, 12), tot(R.countries), "var(--yellow)")}` : `<p class="meta">Countries appear once the GeoIP database is set up (see the firewall notes).</p>`}
<h3 class="cat">Devices</h3>${bars(top(R.devs, 4), tot(R.devs), "var(--blue)")}<h3 class="cat">Browsers</h3>${bars(top(R.brs, 6), tot(R.brs), "var(--blue)")}<h3 class="cat">Systems</h3>${bars(top(R.oss, 6), tot(R.oss), "var(--blue)")}
${R.downloads ? `<h3 class="cat">Downloads</h3>${bars(top(R.dls, 8), R.downloads, "var(--orange)")}` : ""}
<h3 class="cat">Total downloads by app file (all time)</h3>${store.read("apps.json").flatMap(a => (a.releases || []).flatMap(r => r.files.map(f => `<div class="row"><strong>${esc(a.name)} ${esc(r.version)}</strong><span class="meta">${esc(f.label)}</span><span class="meta">${f.downloads || 0} downloads</span></div>`))).join("") || '<p class="meta">No app files yet.</p>'}`, { head: UI }));
  });
  return { admin, _build: build };
};
