// Server code for the plugin. It runs in a sandbox: no files, no internet, no other Node modules (only crypto, util, path, url, events).
// Everything it can do comes from the "vp" object that VibePress hands in.
module.exports = function (vp) {
  vp.route("GET", "/count", async function () {
    const n = (await vp.kv.get("hits")) || 0;
    return { json: { hits: n } };
  });

  vp.route("POST", "/hit", async function (req) {
    // req.visitor is an anonymous per-visitor code (never the real IP address), good for "once per visitor" rules.
    const seen = (await vp.kv.get("seen")) || {};
    const today = new Date().toISOString().slice(0, 10);
    if (seen.day !== today) { seen.day = today; seen.ids = []; }
    let n = (await vp.kv.get("hits")) || 0;
    if (!seen.ids.includes(req.visitor) && seen.ids.length < 2000) { seen.ids.push(req.visitor); n += 1; await vp.kv.set("hits", n); await vp.kv.set("seen", seen); }
    return { json: { hits: n } };
  });
};
