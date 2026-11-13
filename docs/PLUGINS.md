# Plugins

Plugins let you (or an AI helping you) add pages and features to a VibePress site, and share them with other VibePress owners as a single `.vpplugin` file. They are built so that the common cases need **no server code at all**, and the rest run in a locked box.

## Three kinds of plugin, from safest to most powerful

| Kind | What it can do | Runs where | Risk to you |
|---|---|---|---|
| **Pages only** | Pages with their own scripts and styles (calculators, games, tools, galleries) | In the visitor's browser, in a sandbox | Very low |
| **Pages + collections** | The above, plus lists of visitor entries (guestbook, comment wall, suggestions, sign-ups) that you approve in the admin | Browser sandbox. Entries are checked by VibePress itself; no plugin code runs on your server | Low |
| **Server code** | Custom logic (counters, small APIs, fetching public data) | A separate, restricted Node process | Needs trust in the author |

Install the safest kind that does the job. The admin review screen tells you which kind a plugin is.

## How it keeps your site safe

1. **You decide, with the facts.** Uploading a plugin never installs it. A review screen shows what it adds, every permission in plain English, its SHA-256 fingerprint, and anything suspicious found in its files. Each permission needs a tick; server code needs an extra "I trust the author" tick.
2. **The package is treated as hostile until proven otherwise.** Only a short list of file types is accepted; links, `..` paths, huge files and zip bombs are refused; at most 120 files and 3 MB unpacked.
3. **Pages are isolated by the browser.** Nginx serves `/x/<plugin>/` with a `sandbox` Content-Security-Policy: the page gets an empty identity, so it cannot read your cookies or admin pages, cannot touch other pages, can load scripts only from itself, and can only call `/x-api/`. Calls from a plugin page never carry your admin login.
4. **Collections are checked by the host.** The plugin declares fields (type, length, choices); VibePress validates every submission, drops unknown fields, rate-limits visitors, and (by default) holds entries until you approve them. Admin pages escape everything they show.
5. **Server code runs in a cage.** Each server plugin gets its own Node process started with Node's permission model: no files outside its own folder (read-only), no writing anywhere, no starting programs, no workers, no native add-ons. It also gets an empty environment (it never sees your `.env` or secrets), no `eval`, no `fetch`/`WebSocket`, no `import()`, and its own tiny module loader that only hands out `crypto, util, path, url, events, querystring, buffer, assert` and the plugin's own files. 64 MB memory, 3 seconds per request, 6 requests at once; a plugin that crashes 5 times in 5 minutes is switched off.
6. **Everything a plugin asks of VibePress is checked.** Its storage is its own (64 KB per value, 2 MB total). Page lists and site info need a permission. Internet access exists only as `net:<host>`: https, that host only, no redirects, never private or internal addresses (checked at connection time), 512 KB maximum.

Run `node app/plugins/selftest.js` on your server at any time. It installs a deliberately hostile plugin into a throw-away folder and shows that each attack (reading `/etc/passwd`, running commands, opening network connections, `process.binding`, `eval`, endless loops, memory bombs, and more) is stopped.

### Honest limits
* **It is a strong fence, not a bank vault.** Node's permission model does not itself block network sockets, so VibePress removes every normal route to them. A very skilled attacker who found a new route could still make outbound connections from the server process. That is why server-code plugins need a trusted author. Pages-only and collection plugins do not have this exposure.
* A plugin page lives on your domain. It cannot steal your login, but it can still show misleading content. Read pages before you install, as you would any content.
* A plugin can use up its CPU, memory and storage allowance.
* Plugin endpoints are public: there are no admin-only plugin routes yet.
* Check the browser sandbox is active on your server: `curl -sI https://YOURSITE/x/guestbook/ | grep -i content-security-policy` should print a line starting with `sandbox`. (The updater adds the Nginx settings for you.)

## Using plugins
**Admin > Plugins**: upload a `.vpplugin`, read the review, tick, install. **A plugin never changes your existing pages.** It adds its own page (at `/x/<plugin>/`) that nobody finds until you link to it, so after installing press **Add to the menu** or **Add to the home page** on the plugin's card (one click, the site is rebuilt for you), or share its address. If nothing seems to work, press **Check that my website serves plugins**: it asks your site's public address, as a visitor would, and tells you what is missing. Each plugin can be turned off, removed (keeping or deleting its data), exported to share, and (server plugins) inspected on a status page. Collection entries are moderated from the plugin's card.

## Sharing
Press **Export to share** on an installed plugin to get the exact file you installed, or run `node plugin-kit/vp-plugin.js pack my-folder`. Publish the file together with its SHA-256 fingerprint (a GitHub release, your own site, a chat). Anyone installing it sees the fingerprint on the review screen and can compare. Updating is the same flow: upload a newer version and its saved data is kept.

## Making one (with an AI)
1. Open `plugin-kit/PLUGIN-AI-PROMPT.md`, paste it into an AI chat, and describe your idea.
2. Save the files it gives you into a folder.
3. `node plugin-kit/vp-plugin.js check my-folder`, paste any messages back to the AI until it says OK.
4. `node plugin-kit/vp-plugin.js pack my-folder`, then install it on your own site first.

`node plugin-kit/vp-plugin.js new my-plugin` creates a starter folder. Three working examples are in `plugin-kit/examples/`.

## Reference
**plugin.json**: `id`, `name`, `version` (1.0.0), `author`, `description`, `vibepress` (oldest version it works with), optional `license`, `permissions`, `pages` (`[{title, path}]`, files in `public/`), `collections`, `server`.

**Permissions**: `pages:read`, `site:read`, `files:private`, `net:<public hostname>`.

**Collections**: up to 5 per plugin, 20 fields each; field types `string` (`max` up to 1000), `number` (`min`, `max`), `boolean`, `choice` (`options`); `approval` `manual` (default) or `auto`; `publicRead`, `publicWrite` (default true); `maxItems` (default 500, up to 2000). Page calls: `GET /x-api/<id>/data/<name>?limit=50`, `POST /x-api/<id>/data/<name>`.

**Server code**: `module.exports = function (vp) { ... }`. `vp.route("GET"|"POST", "/path/:param", async (req) => ({ json | text | html, status? }))`, called from pages at `/x-api/<id>/r/path`. `req` has `method, path, query, body, params, visitor` (an anonymous per-visitor code, never the address). Also `vp.kv.get/set/delete/list`, `vp.pages.list()`, `vp.site.get()`, `vp.fetch(url, { timeout })`, `vp.settings.get()`, `vp.files.list()` / `vp.files.grant(fileId, { ttl, uses })`, `vp.data.add/find/update/approve/list(collection, ...)` and `vp.log()`. The next section explains the last three groups.

**Where things live**: code in `app/data/plugins/<id>/`, each plugin's data in `app/data/plugin-data/<id>.json`, published pages in `site/x/<id>/`, the install list in `app/data/plugins.json`.

## Settings pages, private files and server-written records (0.3)
These three features let a plugin do real work for the site owner, such as selling downloads (see `plugin-kit/examples/crypto-downloads`).

**Settings page.** A plugin declares `settings` in `plugin.json` and VibePress builds the form in **Admin > Plugins > Settings**, with validation and CSRF protection, so the plugin needs no admin code. `settings.fields` are single values; `settings.lists` are repeatable rows (a product list, say; each row gets a stable id). Field types: `string` (`max`, optional `check`), `number` (`min`, `max`, `default`), `boolean`, `choice`, `decimal` (a plain number like `0.0025`, never floating point) and `file` (one of the plugin's private files). Every field can have a `label`, `help`, `required` and `default`. A `check` of `btc-address`, `eth-address` or `ton-address` verifies the checksum of a wallet address before it is saved, to catch typos. Server code reads the values with `vp.settings.get()` which returns `{ values, lists }`.

**Private files** (permission `files:private`). The owner uploads files under **Plugins > Files**. They are stored in `app/data/plugin-files/<plugin>/`, outside the web folder, with owner-only permissions, together with a SHA-256 checksum. Plugin code never sees the bytes or the paths: it can list names, sizes and checksums (`vp.files.list()`) and ask for a short-lived link (`vp.files.grant(fileId, { ttl: 600, uses: 3 })`, up to 1 hour and 10 uses). VibePress serves the link at `/x-api/<plugin>/dl/<token>` as an attachment. Only a hash of the token is stored. Deleting a file kills its open links. Files are up to 500 MB each and 4 GB per plugin (change with `PLUGIN_FILE_MAX_MB` and `PLUGIN_FILES_TOTAL_MB` in `app/.env`). **Data backups do not include private files**, so the owner must keep their own copies.

**Server-written collections.** A collection with `"publicWrite": false` and `"publicRead": false` can only be written by the plugin's own server code, through `vp.data.add(collection, values, { approved })`, `vp.data.find(collection, field, value)`, `vp.data.update(collection, id, values)`, `vp.data.approve(collection, id, true|false)` and `vp.data.list(collection, { approved, limit })`. Values are checked against the collection's declared fields exactly like visitor entries. The owner sees the records in the plugin's admin card, and the `approved` switch can be given its own wording with `"labels": { "on": "Paid", "off": "Unpaid", "approve": "Mark as paid", "hide": "Mark as unpaid" }`, so the owner can correct a record by hand.

**More time for slow calls.** A plugin that talks to other websites may declare `"timeout": 10` (3 to 10 seconds, default 3). `vp.fetch(url, { timeout: 3500 })` can shorten a single call so one slow site cannot use up the whole budget. The address checks (https only, declared host, no credentials, port 443) always run before any request is sent.

**A setup check for the owner.** Server code may define a route called `/__status`. Visitors can never reach any route whose name starts with `__`, but the admin's **Setup check** button and the plugin's Settings page call it and show the answer: `return { json: { items: [{ ok: true, text: "2 files uploaded" }, { ok: false, text: "No wallet address entered", fix: "Open Settings and enter one." }] } }`. Use it to say exactly what is still missing, so an owner is never left guessing why a plugin shows nothing.

What these add to the honest limits:
* Plugin pages may now start file downloads (the sandbox header includes `allow-downloads`), which is how a purchased file reaches the buyer.
* The shared header script on a plugin page reads the public `/site.json`, which Nginx now serves with an open CORS header so a sandboxed page can read it.
* Private files and plugin data sit on the server's disk and are readable by the VibePress service user and anyone with server access; server plugins themselves cannot read them.

## Requirements and troubleshooting
* `unzip` (the installer and updater add it) and, for server plugins, Node 22.13 or newer (`node -v`). Without it, page and collection plugins still work and the admin says so.
* "Plugin pages show unstyled or the header is missing": the Nginx plugin settings are missing. Re-run `sudo bash update.sh`.
* "The plugin stopped" (the plugin's page says there is a technical problem): its server part cannot start. Open **Status** on the plugin's card: it runs a live test and the messages below it say why. VibePress tries each Node.js option before relying on it, because Node changes them between versions (Node 24 removed `--no-experimental-fetch`, which broke 0.3.5 and earlier). The kit's tests run on Node 22 and Node 24; to test another version, run `VP_EXTRA_NODES=/path/to/node node plugin-kit/tests/run-all.js`.
* "A server plugin switched itself off": open its **Status** page for the last messages from the plugin.

## Ideas for later
Plugin settings screens in the admin, widgets for the home page, admin-only plugin routes, signed packages and a shared plugin directory, and an optional separate network-less service for an even harder wall around server code.
