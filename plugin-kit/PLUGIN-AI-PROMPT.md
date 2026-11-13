# Build a VibePress plugin with an AI

1. Copy everything below the line into a new chat with Claude (or any AI).
2. Replace the last line with your idea.
3. Save each file the AI gives you into a folder, then run:
   `node plugin-kit/vp-plugin.js check my-folder` (fix anything it reports; paste the messages back to the AI)
   `node plugin-kit/vp-plugin.js pack my-folder` (makes a `.vpplugin` file)
4. In your admin, open **Plugins**, upload the file, read the review screen, and install.

---

You are helping me write a **plugin for VibePress**, a self-hosted website. Plugins run inside strict sandboxes, so follow these rules exactly. Output every file in its own code block, with its path as a heading (for example `plugin.json`, `public/index.html`, `server.js`). Keep it small and simple. Do not add libraries.

## Folder layout
```
plugin.json          (required)
public/              (web pages, scripts, styles, images; served at /x/<id>/)
server.js            (optional; only if the plugin truly needs server code)
```

## plugin.json
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Name",
  "description": "One sentence.",
  "vibepress": "0.2.0",
  "permissions": [],
  "pages": [{ "title": "My Page", "path": "index.html" }],
  "collections": {},
  "server": "server.js"
}
```
- `id`: 3-30 lowercase letters, digits, hyphens. `pages[].path` is a file inside `public/`. Leave out `server` and `collections` if not needed.
- `permissions` (ask for as few as possible, none is best): `"pages:read"` (list the site's published pages), `"site:read"` (site name and address), `"net:api.example.com"` (server code may call that one public https host).

## Pages (public/*.html, *.js, *.css)
Pages run in a browser sandbox. Rules:
- **No inline scripts and no inline event handlers.** Put code in a separate file: `<script src="app.js" defer></script>`. Never use `onclick="..."`; use `addEventListener`.
- **No outside resources.** No CDN scripts, no Google Fonts links, no images or APIs from other websites. Bundle small assets inside `public/` (images as files or `data:` URLs).
- **No cookies, localStorage or sessionStorage** (they do not work in the sandbox). Save data with a collection or the server API.
- Only call the plugin's own address: `fetch("/x-api/<id>/...")`.
- Show visitor-supplied text with `textContent`, never `innerHTML`.
- Never name a top-level variable `status`, `name`, `top`, `length`, `event`, `location`, `history`, `frames`, `self`, `origin` or `parent`. These are built-in browser globals (e.g. `window.status`); assigning your own value to one of these names can silently fail or turn into text instead of the value you expected, with no error shown. Use a different name, such as `statusEl` or `msgEl`.
- To match the site, start every page like this:
```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page title</title>
<link rel="stylesheet" href="/shared/tds.css"><script src="/shared/tds.js" defer></script>
<script src="app.js" defer></script></head>
<body><div id="tds-header"></div><main>
  <h1 class="bubble">Heading</h1>
  <div class="card" style="--c:var(--blue)">A card</div>
  <span class="btn" style="--c:var(--purple)">Button look</span>
</main>
<div id="tds-footer"></div></body></html>
```
Theme colors are CSS variables: `--bg --card --ink --muted --red --orange --yellow --green --blue --purple`. Use them instead of fixed colors so the page follows the site's theme (light or dark).

## Saving visitor data WITHOUT server code (preferred)
Declare a collection in `plugin.json`:
```json
"collections": { "messages": {
  "fields": { "name": {"type":"string","max":40,"required":true}, "message": {"type":"string","max":280,"required":true}, "mood": {"type":"choice","options":["happy","silly"]} },
  "approval": "manual", "maxItems": 300 } }
```
Field types: `string` (with `max`, up to 1000), `number` (`min`, `max`), `boolean`, `choice` (`options`). `approval`: `"manual"` (admin approves each entry first; the safe default) or `"auto"`. The page then uses:
- `GET  /x-api/<id>/data/<collection>?limit=50` returns `{ "items": [ {id, at, ...fields} ] }` (approved entries only, newest first)
- `POST /x-api/<id>/data/<collection>` with a JSON body of the fields returns `{ "ok": true, "pending": true/false }` or `{ "error": "..." }`
Visitors are rate limited automatically.

## Server code (only when really needed): server.js
```js
module.exports = function (vp) {
  vp.route("GET", "/count", async (req) => ({ json: { hits: (await vp.kv.get("hits")) || 0 } }));
  vp.route("POST", "/hit", async (req) => { /* req.method, req.path, req.query, req.body (object or null), req.visitor (anonymous code), req.params */
    const n = ((await vp.kv.get("hits")) || 0) + 1; await vp.kv.set("hits", n); return { json: { hits: n } }; });
};
```
The page calls routes at `/x-api/<id>/r/<route>`. A handler returns `{ json: ... }`, `{ text: "..." }` or `{ html: "..." }`, optionally with `status: 400`.
What `vp` offers: `vp.route(method, path, handler)` (GET or POST; `:name` path parts become `req.params`), `vp.kv.get/set/delete/list` (this plugin's own storage, 64 KB per value, 2 MB total), `vp.log(...)`, and with permissions: `vp.pages.list()` (`pages:read`), `vp.site.get()` (`site:read`), `vp.fetch(url)` returning `{status, text, json()}` (`net:<host>`, https only, that host only, 512 KB max).
The sandbox rules: server code can only `require` its own files and `crypto`, `util`, `path`, `url`, `events`, `querystring`, `buffer`, `assert`. No `fs`, `http`, `net`, `child_process`, no `import`, no `eval`, no `fetch`, no `process.env`. Each request has 3 seconds and the process has 64 MB, so keep work small. Endpoints are **public**: anyone can call them. Never trust `req.body`; check type and length of everything. Never put secrets in a plugin.

## Owner settings, private files and records (only if the plugin needs them)
- `"settings"` in plugin.json makes VibePress build a settings page for the owner: `{ "fields": { "key": { "type": "string|number|boolean|choice|decimal|file", "label": "...", "help": "...", "required": true, "default": ... } }, "lists": { "products": { "label": "Products", "max": 30, "fields": { ... } } } }`. `string` takes `max` and an optional `check` (`btc-address`, `eth-address`, `ton-address`); `number` takes `min` and `max`; `choice` takes `options`; `decimal` is a plain number like `0.0025`. Server code reads it with `await vp.settings.get()` which returns `{ values, lists }` (each list row has a stable `id`).
- Permission `"files:private"`: the owner uploads files in the admin (never in `public/`). Server code can `await vp.files.list()` (id, name, size, sha256) and `await vp.files.grant(fileId, { ttl: 600, uses: 3 })` which returns `{ url }`, a short-lived download link the page can open. Code never reads file contents.
- A collection with `"publicRead": false, "publicWrite": false` is written only by server code: `await vp.data.add(collection, values, { approved })`, `vp.data.find(collection, field, value)`, `vp.data.update(collection, id, values)`, `vp.data.approve(collection, id, true)`, `vp.data.list(collection, { approved, limit })`. Add `"labels": { "on": "Paid", "off": "Unpaid", "approve": "Mark as paid", "hide": "Mark as unpaid" }` so the owner can correct records by hand. Collections can have up to 20 fields.
- For anything the owner has to set up, add an admin-only route `vp.route("GET", "/__status", ...)` that returns `{ json: { items: [{ ok: false, text: "What is missing", fix: "How to fix it" }] } }`. Visitors can never call routes starting with `__`; the owner sees the list as a Setup check.
- `"timeout": 10` (3 to 10 seconds) is allowed for plugins that call other websites; `vp.fetch(url, { timeout: 3500 })` limits one call. Use `BigInt` and text, never floating point, for money.
- Pages should also include `<div id="tds-footer"></div>` just before `</body>`. Hide elements with `el.hidden = true` only together with CSS `[hidden]{display:none !important}`.

## Output checklist
- Every file the plugin needs, complete (no "...").
- A one-paragraph plain-English summary of what it does and exactly which permissions it asks for and why.
- Prefer a collection over server code, and no permissions over any permissions.

## My plugin idea
(describe it here)
