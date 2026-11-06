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
tar xzf vibepress-NEW.tar.gz && cd vibepress && sudo ./update.sh
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

## Something wrong?
| Problem | Fix |
|---|---|
| Admin page says "Not found" | The app is not running or uses a different admin address. Check `systemctl status vibepress` and `INSTALL-INFO.txt`. |
| `nginx -t` fails | Read the line number it prints. A copy of the original config is in `/etc/nginx/sites-available/vibepress`. |
| Changes do not show | Hard-refresh (Ctrl+Shift+R) or try a private window. |
| Traffic or Firewall report says it cannot read the log | `sudo systemctl restart vibepress` (the service already has permission). |
| Lost your phone | Sign in with a recovery code, or run `cd /var/www/vibepress/app && node setup-admin.js` (type RESET). |
