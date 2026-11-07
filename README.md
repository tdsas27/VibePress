# VibePress

Your own colorful site with an admin area, blog, apps download page, tools and games listings, feedback form, social post creator, traffic stats, firewall, backups, and more. Everything runs on one small Ubuntu server that you control.

## What you need

1. An **Ubuntu 22.04 or newer** server (a small VPS with 1 GB of memory is enough).
2. A **domain name** with an **A record** pointing to the server's IP address (give it a few minutes to spread).
3. A normal user on the server with **sudo** (do not log in as root).
4. An **authenticator app** on your phone (Authy, Google Authenticator, 1Password, and so on) for the admin sign-in.

## Install (about 5 minutes)

On your computer, send the package to the server (change the user and address):

```
scp vibepress-0.1.1.tar.gz youruser@your-server-address:~
```

On the server:

```
tar xzf vibepress-0.1.1.tar.gz
cd vibepress
sudo bash install.sh
```

The installer asks three questions (your domain, your email, your site name), then does everything else: installs the web server and Node.js, copies the files, gets a free HTTPS certificate, starts VibePress as a background service, and finally asks you to **create your admin account** (a password and a QR code to scan with your authenticator app).

When it finishes it prints your **site address** and your **hidden admin address**. Bookmark the admin address. It is also saved in `/var/www/vibepress/INSTALL-INFO.txt`.

> If the installer says your domain does not point at the server yet, create the A record, wait a few minutes, and run it again.

## First 10 minutes after installing

1. Open your admin address and sign in (password, then the 6-digit code).
2. **Footer**: add your contact email, choose which social links show, then press **Create the missing policy pages** to make the Privacy Policy and Cookie Policy.
3. **SEO**: check the health list, then submit `https://your-domain/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
4. **Blog**: write your first post (tag it `games`, `3d` or `tools` to show it on those pages).
5. **Backup**: press **Create backup now** once to see how it works. A data backup also runs by itself every day.

## Make it yours (branding)

Everything about the look lives in one file: `/var/www/vibepress/brand.json`. Edit it with `nano`, then rebuild the pages:

```
sudo nano /var/www/vibepress/brand.json
cd /var/www/vibepress/app && node render-site.js
```

You can change the name, tagline, colors, font, logo, menu, footer columns, home page cards, section titles, and add a support page (tip links and crypto addresses). Replace the pictures in `/var/www/vibepress/site/shared/img/` (logo, section art, and the share image `og.jpg`) with your own. See `docs/BRANDING.md` for every setting.

## Adding content

* **Blog, Links, Apps, Pages, Social posts, Feedback, Traffic, Firewall, Backup**: all in the admin dashboard.
* **Games, 3D Things, Tools**: upload a page or a folder (with an `index.html`) into `/var/www/vibepress/site/games/`, `.../other/` or `.../tools/` and it appears in the listing within 5 minutes. Or create pages straight from the admin **Pages** tool.

## Updating

Download the new release, unpack it, and run:

```
cd vibepress
sudo bash update.sh
```

It makes a backup first, keeps your settings, data, uploads and custom images, and restarts the app.

## Handy commands

```
sudo systemctl status vibepress          # is it running?
sudo journalctl -u vibepress -f          # live log (Ctrl+C to stop)
sudo systemctl restart vibepress         # restart after changing .env
sudo nginx -t && sudo systemctl reload nginx
```

More in `docs/CHEATSHEET.md`.

## Removing VibePress

```
sudo systemctl disable --now vibepress vibepress-firewall.path vibepress-index.timer
sudo rm /etc/systemd/system/vibepress* /etc/nginx/sites-enabled/vibepress /etc/nginx/sites-available/vibepress
sudo systemctl daemon-reload && sudo systemctl reload nginx
sudo rm -r /var/www/vibepress        # deletes your site and data: make a backup first
```

## Good to know

* This is version 0.1.1 (a first release). The installer has been checked for syntax but should be tried on a fresh test server before you rely on it.
* The font loads from Google Fonts by default (the privacy policy mentions this). Set `"font": {"import": ""}` in brand.json to use your device's fonts instead.
* Section folders (`games`, `other`, `tools`) keep their addresses; you can rename their titles freely.
* See `LICENSE.txt` for the terms.
