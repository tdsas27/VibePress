# Branding with brand.json

File: `/var/www/vibepress/brand.json`. After editing, run `cd /var/www/vibepress/app && node render-site.js`, then hard-refresh your browser.

| Setting | What it does |
|---|---|
| `name` | Site name (menu, footer, titles, home page, admin sign-in code). Also set `SITE_NAME` in `app/.env` and run `sudo systemctl restart vibepress`. |
| `tagline` | Line under the name on the home page and in search results. |
| `domain` | Used for canonical addresses and sharing tags. |
| `logo` | Round logo used in the footer and 404 page. |
| `colors` | `bg`, `card`, `ink`, `muted`, `red`, `orange`, `yellow`, `green`, `blue`, `purple` as `#rrggbb`. Leave any out to keep the default. |
| `font` | `family` (name) and `import` (a Google Fonts address, or `""` for none). |
| `nav` | Header menu: a list of `{ "label": "...", "href": "/page/" }`. |
| `footer.groups` | Footer link columns: `{ "title": "Explore", "links": [ ... ] }`. |
| `footer.cta` | Big footer button, for example `{ "label": "Support us", "href": "/support/" }`, or `null`. |
| `sections` | Titles, intro text, picture and blog tags for `games`, `other` and `tools`. |
| `home.cards` | Cards on the home page: `title`, `text`, `href`, `image`, `color`. |
| `support` | `null` for no support page, or an object: `intro`, `buttons` (`label`, `sub`, `url`, `color`) and `crypto` (`coin`, `network`, `address`). Add `"Support"` to `nav` as well. |

The footer social icons, legal links and copyright are edited in the admin **Footer** page (no file editing needed).

Colors affect the dark theme's accents. A light theme is planned for a later version.
