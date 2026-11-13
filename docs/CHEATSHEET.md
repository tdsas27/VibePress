# Cheat sheet

## Everyday
```
sudo systemctl status vibepress
sudo systemctl restart vibepress
sudo journalctl -u vibepress -n 50 --no-pager
cat /var/www/vibepress/INSTALL-INFO.txt        # your admin address
```

## Change branding
```
sudo nano /var/www/vibepress/brand.json
cd /var/www/vibepress/app && node render-site.js
```

## Update to a new release
```
tar xzf vibepress-NEW.tar.gz && cd vibepress && sudo bash update.sh
```

## Settings file
`/var/www/vibepress/app/.env` (site address, name, folders, optional Turnstile keys, optional GeoIP file). After editing: `sudo systemctl restart vibepress`.

## Backups by hand
```
sudo tar czf ~/vibepress-backup-$(date +%F).tar.gz -C /var/www/vibepress site app/data app/.env brand.json
```

## Web server
```
sudo nginx -t && sudo systemctl reload nginx
sudo tail -n 30 /var/log/nginx/error.log
sudo certbot renew --dry-run
```

## Change the menu or the look
Sign in to the admin, then:
* **Menu**: pick a page and press *Add this page*, use the arrows to re-order, the cross to remove, then *Save menu*.
* **Theme**: pick a look or choose a main color, adjust anything you like, check the live preview, then *Save theme*. *Undo the last change* puts the previous theme back.
Both pages rebuild the site for you. If you do not see a change, hard-refresh (Ctrl+Shift+R).

## Updating from the admin
**Admin > Updates**: enter a GitHub repository and press Check, or upload a release `.zip` by hand. Either way you review it first. A one-click Apply button only appears once you've added the one-line sudoers rule the page shows you; otherwise copy the SSH command it gives you.

## Closing the site for maintenance
Admin > Maintenance. Write the message, then **Save and close the site**. Every public page shows it (with a "503, back soon" signal for search engines); the admin stays open. Press **Check what visitors get** to confirm. **Show me the real site** lets only your browser see the live site while it is closed. Pick "reopen automatically after" so it cannot be forgotten, or press **Reopen the site now**.

If the page says "One-time setup needed", your Nginx file predates this feature: run the updater once (`sudo bash update.sh` in the new release folder, or Admin > Updates). Until then only the app's own pages (blog, links, forms) close, not the static pages.

## Header banner and the VibePress credit
**Admin > Theme** has a "Header banner image" section (upload a wide image, choose a height, optionally darken the bottom edge) and a "Powered by VibePress" checkbox for the footer credit.

## Plugins
**Admin > Plugins** > choose a `.vpplugin` file > read the review > tick the boxes > Install. **Installing does not change your existing pages.** The plugin adds its own page at `/x/<plugin>/`; press **Add to the menu** or **Add to the home page** on its card to make it visible. Nothing showing up? Press **Check that my website serves plugins** on the same page. Guestbook-style plugins collect entries that wait for your approval on the plugin's card. To make your own, see `plugin-kit/PLUGIN-AI-PROMPT.md`. Test the safety cage any time: `node /var/www/vibepress/app/plugins/selftest.js`.

## Selling downloads for Bitcoin, Ethereum or TON
Install the **Crypto Downloads** plugin (`plugin-kit/examples/crypto-downloads`). Then: Plugins > Crypto Downloads > **Files** (upload what you sell) > **Settings** (your wallet addresses and products) > add **Shop** to your menu. Test each coin with a small real purchase before you announce it. Orders are listed on the plugin's card; use **Mark as paid** if a customer paid but was not recognised. Read the plugin's `README.md` first.

## The theme does not change on my site
Open **Admin > Theme** and read the **Is it live?** box. It compares your saved theme with the stylesheet your server is really sending.
* It says they **match**, but you still see the old look after a hard refresh: an old copy is cached between you and the server. Try a private window. If your domain uses a CDN such as Cloudflare, purge its cache for `/shared/tds.css`.
* It says they **differ**: the site was not rebuilt. Press **Rebuild site now**; if it fails, the message says why.
You can also check from any computer: `curl -s https://YOURSITE/shared/tds.css | grep -o -- '--bg:#[0-9a-f]*' | tail -1` prints the background color the server sends.

## Something wrong?
| Problem | Fix |
|---|---|
| Admin page says "Not found" | The app is not running or uses a different admin address. Check `systemctl status vibepress` and `INSTALL-INFO.txt`. |
| `nginx -t` fails | Read the line number it prints. A copy of the original config is in `/etc/nginx/sites-available/vibepress`. |
| Changes do not show | Hard-refresh (Ctrl+Shift+R) or try a private window. |
| Traffic or Firewall report says it cannot read the log | `sudo systemctl restart vibepress` (the service already has permission). |
| Lost your phone | Sign in with a recovery code, or run `cd /var/www/vibepress/app && node setup-admin.js` (type RESET). |


## Renaming the site
**Admin > Site name** changes the site name, the home page title and the tagline, and rebuilds the site. Plugin pages' "Back To" link always goes to the home page.
