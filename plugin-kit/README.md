# VibePress plugin kit

* `examples/` four working plugins: **hello-world** (page only), **guestbook** (visitors leave messages you approve, no server code), **hit-counter** (sandboxed server code) and **crypto-downloads** (a complete shop: settings page, private files, Bitcoin/Ethereum/TON payments, orders, expiring download links).
* `tests/` the plugin test suites. `node plugin-kit/tests/run-all.js` runs all of them.
* `vp-plugin.js` the author's tool: `new <id>`, `check <folder>`, `pack <folder>`. Needs only Node.
* `PLUGIN-AI-PROMPT.md` paste it into an AI, add your idea, and get a ready-to-pack plugin.
* Full guide: `../docs/PLUGINS.md`.

Try it: `node vp-plugin.js pack examples/guestbook` then upload the `.vpplugin` file in Admin > Plugins.
