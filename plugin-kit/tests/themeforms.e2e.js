#!/usr/bin/env node
// Regression test for "Form expired" on Admin > Theme > Save banner. The cause was a <form> nested inside another <form>: browsers
// drop the inner form tag, so Save banner submitted the OUTER form with two _csrf fields (an array on the server, so the token never matched).
// Renders the real Theme page, loads it in real Chromium and checks what each button really submits.   node plugin-kit/tests/themeforms.e2e.js
// Skips cleanly without Python Playwright.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const { load, makeCounter } = require("./harness");
const T = makeCounter(), ok = T.ok;
if (spawnSync("python3", ["-c", "import playwright.sync_api"], { stdio: "ignore" }).status !== 0) { console.log("Skipped: no Python Playwright here.\n0 passed, 0 failed.\n"); process.exit(0); }
const H = load(); process.env.UPLOAD_DIR = path.join(H.tmp, "uploads");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const doc = b => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body><main>${b}</main></body></html>`;
const theme = require(path.join(__dirname, "..", "..", "app", "theme.js"))({ page: (t, b) => doc(b), h1: t => `<h1>${t}</h1>`, esc, hidden: () => '<input type="hidden" name="_csrf" value="TOKEN123">', verifyCsrf: (q, s, n) => n() });
(async () => {
  const html = (await H.call(theme.admin, "GET", "/", {})).body;
  const out = path.join(H.tmp, "theme.html"); fs.writeFileSync(out, html);
  const py = `
import json, sys
from urllib.parse import parse_qs
import playwright.sync_api as p
html = open(sys.argv[1], encoding="utf8").read(); seen = []; res = {}
with p.sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page()
    def handler(route):
        r = route.request
        if r.url.endswith("/theme"): return route.fulfill(status=200, content_type="text/html", body=html)
        if r.method != "POST": return route.fulfill(status=200, content_type="application/javascript", body="")
        seen.append({"url": r.url, "ct": r.headers.get("content-type", ""), "body": r.post_data_buffer.decode("latin1") if r.post_data_buffer else ""})
        route.fulfill(status=200, content_type="text/html", body="<html><body>saved</body></html>")
    pg.route("http://test.local/**", handler)
    pg.goto("http://test.local/theme")
    res["nested"] = pg.evaluate("[...document.querySelectorAll('form form')].length")
    res["banner_form"] = pg.evaluate("(() => { const f = document.querySelector('input[name=image]').form; return f ? [f.getAttribute('action'), f.enctype, f.querySelectorAll('[name=_csrf]').length] : null })()")
    res["theme_form_has_file_input"] = pg.evaluate("!!document.querySelector('#themeform input[type=file]')")
    res["save_theme_form"] = pg.evaluate("[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Save theme').map(b => b.form && b.form.getAttribute('action'))")
    pg.set_input_files("input[name=image]", {"name": "a.png", "mimeType": "image/png", "buffer": b"\\x89PNG\\r\\n\\x1a\\nfake"})
    pg.click('button:text-is("Save banner")')
    for _ in range(50):
        if seen: break
        pg.wait_for_timeout(100)
    pg.wait_for_timeout(300)
    res["requests"] = seen
    b.close()
print(json.dumps(res))`;
  const r = spawnSync("python3", ["-c", py, out], { encoding: "utf8", timeout: 60000 });
  let o = {}; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* reported below */ }
  ok("the browser ran the check", !!o.requests, r.stdout + r.stderr);
  ok("no form is nested inside another form on the Theme page", o.nested === 0, o.nested);
  ok("the banner file input belongs to a multipart form posting to /admin/theme/banner with exactly one _csrf", JSON.stringify(o.banner_form) === JSON.stringify(["/admin/theme/banner", "multipart/form-data", 1]), JSON.stringify(o.banner_form));
  ok("the main theme form has no file input", o.theme_form_has_file_input === false);
  ok("Save theme still posts to /admin/theme/save", JSON.stringify(o.save_theme_form) === JSON.stringify(["/admin/theme/save"]), JSON.stringify(o.save_theme_form));
  const q = (o.requests || [])[0] || {};
  ok("pressing Save banner sends one multipart request to /admin/theme/banner", (o.requests || []).length === 1 && /\/admin\/theme\/banner$/.test(q.url || "") && /^multipart\/form-data/.test(q.ct || ""), JSON.stringify(o.requests).slice(0, 300));
  ok("...carrying the image and a single CSRF token", /name="image"; filename="a\.png"/.test(q.body || "") && (String(q.body || "").match(/name="_csrf"/g) || []).length === 1 && /TOKEN123/.test(q.body || ""), String(q.body).slice(0, 300));
  const code = T.done(); H.cleanup(); process.exit(code);
})().catch(e => { console.log("CRASH " + e.stack); process.exit(1); });
