# What is included

* **Admin** at a hidden address, with password + two-step authenticator sign-in, recovery codes, rate limiting and a 2-hour session.
* **Blog** with Markdown, drafts, tags, RSS, image upload with automatic resizing and thumbnails, and recent-post strips on the home page and section pages.
* **Apps (app store)**: apps with icons, screenshots, versions, notes, per-platform downloads (Windows, macOS, Linux, Android, Google TV, iOS), checksums and download counts.
* **Games, 3D Things, Tools**: automatic listings from uploaded pages or folders, plus a **page creator** for text (Markdown) and HTML pages in any section.
* **Links** page with click counts and short redirects (`/go/name`).
* **Feedback** form with spam protection (honeypot, rate limits, link filter, spam folder, optional Cloudflare Turnstile) and a tester application with required details and social links.
* **Social post creator**: one message turned into ready-to-post text for 11 networks, with tracked links, share buttons and downloadable share card images.
* **Traffic**: visitors, page views, sources, campaigns, countries, devices and downloads, read from the server log (no tracking scripts or cookies).
* **Firewall**: block by IP, range, subnet or country; allowlist; automatic bans; traffic report. Blocks also apply to the static site through Nginx.
* **Maintenance mode** (Admin > Maintenance): close the whole public site with one switch and show your own message (headline, text, expected-back time, contact line). Visitors get a proper "503, back soon" signal so search engines keep your rankings; the admin stays open; a preview cookie lets you look at the real site meanwhile; optional automatic reopening; a live check tells you what visitors really get.
* **Backup and restore**: data only or the entire site, daily automatic data backups, downloads and uploads.
* **SEO**: sitemap, robots.txt, canonical and sharing tags, structured data, health check.
* **Footer builder**: social icons you choose, legal links, copyright, plus starter **Privacy Policy** and **Cookie Policy** pages.
* **Menu editor** (Admin > Menu): add pages with one click, rename, re-order or remove top-menu links, add custom links, reset to the standard menu.
* **Theme generator** (Admin > Theme): ready-made looks, a one-color palette generator (dark or light, full rainbow or shades of your color), 15 fonts, fine-tune every color, live preview, contrast warnings, one-click undo.
* **Updates** (Admin > Updates): check a GitHub repository for a new release, or upload a release file by hand. A staged update applies itself only if the server owner has added one narrow, disclosed sudoers line; otherwise the exact command to run over SSH is shown. Nothing is ever applied silently.
* **Header banner image** (Admin > Theme): an optional wide image behind the top menu, on every page, with small/medium/large heights and an optional darkening overlay for readable menu text.
* **"Powered by VibePress" footer credit** (links to https://vibepress.tiedyesasquatch.online), on by default and a single checkbox away from off, in Admin > Theme.
* **Plugins** (Admin > Plugins): add pages and features from `.vpplugin` files. Pages run in a browser sandbox, visitor-entry lists (guestbooks etc.) need no server code, and server code runs in a restricted process. Review-and-approve install, export to share, a plugin kit and an AI prompt for making your own (see `docs/PLUGINS.md`).
* **Sell downloads for crypto** (example plugin `crypto-downloads`): Bitcoin, Ethereum and TON payments straight into your own wallets, private files released through short-lived links only after the payment is confirmed, an orders list where you can mark orders paid by hand. Built on three platform features any plugin can use: owner settings pages, private files and server-written records.
* **Site name** page in the admin: rename the site, set the home page title and tagline; header, footer, page titles and search results all follow.
* **Branding** from one file, `brand.json` (the Menu and Theme pages write to it for you).
