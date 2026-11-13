# Changes

## 0.5.1
* Fixed: **Admin > Theme > Save banner** showed "Form expired. Go back and reload the page." (present since 0.4.0). The banner form had been placed inside the theme form; browsers ignore a form inside a form, so Save banner actually sent the whole theme form with the security token twice, which the server rejected. The banner now has its own form below the theme form (section 5, "Header banner image"), with its own Save banner button.
* Fixed: the same nesting left the **Save theme** button outside any form. It is back inside the theme form.
* New test `themeforms.e2e.js` (real Chromium): fails if any form is nested inside another on the Theme page, and checks that Save banner sends one multipart request to /admin/theme/banner with one token, and Save theme posts to /admin/theme/save.

## 0.5.0
* New: **Admin > Maintenance** (a new tile on the dashboard). One switch closes the whole public site and shows your own message instead: headline, message (paragraphs, https:// links, `{name}` for the site name), an optional "expected back" line, an optional contact line, an emoji and the logo on or off. A preview button shows the page before you close anything.
* Closing answers every public address (home page, blog, links, apps, plugin pages, downloads, forms) with "503 Service Unavailable" and a Retry-After header, so search engines treat it as temporary and keep your rankings. The message page itself asks search engines not to list it.
* The admin stays open, so you cannot lock yourself out. The site's style files stay open so the message looks right.
* **"Show me the real site"** lets just your browser look at the live site for 12 hours while everyone else sees the message (a secret cookie that changes each time you close the site).
* Optional automatic reopening after 1, 2, 4, 8, 24 hours or 3 days, so maintenance mode is never forgotten. The dashboard shows a banner while it is on.
* **Check what visitors get**: the server asks its own web server what a visitor receives and tells you plainly whether the site is really closed (or open).
* Works through Nginx (so the static site closes too) with a second layer inside the app (blog, links, forms, plugin API). Existing installs get the Nginx connection when you run the updater once; until then the admin page says so, and only the app's own pages close.
* `install.sh`/`update.sh`: add the include to the Nginx site file (restoring it if Nginx refuses), create the file, and make the existing watcher reload Nginx when it changes. `update.sh` can be run again safely.
* `store.js` now honours `VP_DATA_DIR` like the rest of the app (tests no longer touch the real data folder).
* New test suite `maintenance.unit.js` (installer/updater steps are run for real in bash with stand-in `nginx`/`systemctl`).

## 0.4.1
* Fixed: plugin pages' "Back To ..." link went up to `/x/` (a folder with no page, so visitors saw "access denied"). It now goes to the home page.
* Fixed: the "Powered by VibePress" credit vanished from every page once a custom copyright line was set in Admin > Footer. It is now kept.
* The credit now links to https://vibepress.tiedyesasquatch.online.
* New: **Admin > Site name** (site name, home page title, tagline). The name is read live from `brand.json`, no restart needed.
* Footer copyright accepts `{name}` for the site name.
* Site name and tagline are escaped before they reach the header/footer script.
