#!/usr/bin/env bash
# VibePress updater. Run from the folder of the NEW release:   sudo bash update.sh
# Keeps your settings (.env), data, brand.json, uploads, downloads and custom images.
set -euo pipefail
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${VIBEPRESS_DIR:-/var/www/vibepress}"
[ "$(id -u)" -eq 0 ] || exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
[ -f "$DIR/app/.env" ] || die "VibePress is not installed in $DIR. Run: sudo bash install.sh instead."
RUN_USER="$(stat -c %U "$DIR/app")"

say "Backing up first"
BK="$DIR/backups/before-update-$(date +%Y%m%d-%H%M).tar.gz"
tar czf "$BK" -C "$DIR" site app/data app/.env brand.json 2>/dev/null || true
chmod 600 "$BK"; chown "$RUN_USER":"$RUN_USER" "$BK"; echo "Saved $BK"

say "Copying the new version"
rsync -a --exclude node_modules --exclude .env --exclude data "$SRC/app/" "$DIR/app/"
rsync -a "$SRC/templates/" "$DIR/templates/"
cp "$SRC/VERSION" "$DIR/VERSION" 2>/dev/null || true
rsync -a --exclude 'shared/img' "$DIR/templates/static/" "$DIR/site/"
for kv in "BRAND_FILE=$DIR/brand.json" "MAX_APP_MB=600"; do grep -q "^${kv%%=*}=" "$DIR/app/.env" || echo "$kv" >> "$DIR/app/.env"; done
chown -R "$RUN_USER":"$RUN_USER" "$DIR/app" "$DIR/templates" "$DIR/site"

say "Updating packages and rebuilding pages"
sudo -u "$RUN_USER" bash -c "cd '$DIR/app' && npm install --omit=dev --no-audit --no-fund"
sudo -u "$RUN_USER" node "$DIR/app/render-site.js"
sudo -u "$RUN_USER" env BRAND_FILE="$DIR/brand.json" node "$DIR/site/scripts/build-index.js" "$DIR/site"
chmod -R a+rX "$DIR/site"

say "Setting up plugin support"
command -v unzip >/dev/null 2>&1 || apt-get install -y unzip
PORT_NOW="$(grep -E '^PORT=' "$DIR/app/.env" | head -1 | cut -d= -f2 || true)"; PORT_NOW="${PORT_NOW:-3100}"
sed "s#__PORT__#$PORT_NOW#g" "$SRC/nginx/plugins.conf.template" > "$DIR/app/data/nginx-plugins.conf"
chown "$RUN_USER":"$RUN_USER" "$DIR/app/data/nginx-plugins.conf"; chmod 644 "$DIR/app/data/nginx-plugins.conf"
NGX=/etc/nginx/sites-available/vibepress
if [ -f "$NGX" ]; then
  if ! grep -q "nginx-plugins.conf" "$NGX"; then
    cp "$NGX" "$NGX.before-plugins"
    sed -i "0,/location \/downloads\//s##include $DIR/app/data/nginx-plugins.conf;\n    location /downloads/#" "$NGX"
  fi
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; else
    [ -f "$NGX.before-plugins" ] && cp "$NGX.before-plugins" "$NGX"
    printf '\n\033[1;33mWarning:\033[0m Nginx did not accept the plugin settings, so they were left out. Plugin pages will not work until this is fixed.\n'
  fi
fi

say "Setting up maintenance mode"
MAINT="$DIR/app/data/nginx-maintenance.conf"
[ -f "$MAINT" ] || echo "# Maintenance mode is off." > "$MAINT"
chown "$RUN_USER":"$RUN_USER" "$MAINT"; chmod 644 "$MAINT"
if [ -f "$NGX" ] && ! grep -q "nginx-maintenance.conf" "$NGX"; then
  cp "$NGX" "$NGX.before-maintenance"
  sed -i "\#nginx-firewall.conf;#a\\    include $DIR/app/data/nginx-maintenance.conf;" "$NGX"
  if grep -q "nginx-maintenance.conf" "$NGX" && nginx -t >/dev/null 2>&1; then systemctl reload nginx; else
    cp "$NGX.before-maintenance" "$NGX"
    printf '\n\033[1;33mWarning:\033[0m Nginx did not accept the maintenance-mode settings, so they were left out. Maintenance mode will only close the app pages (blog, links, forms) until this is fixed.\n'
  fi
fi
WATCH=/etc/systemd/system/vibepress-firewall.path
if [ -f "$WATCH" ] && ! grep -q "nginx-maintenance.conf" "$WATCH"; then
  sed -i "/^PathChanged=/a PathChanged=$MAINT" "$WATCH"
  systemctl daemon-reload; systemctl restart vibepress-firewall.path || true
fi

say "Restarting"
systemctl restart vibepress
sleep 3
systemctl is-active --quiet vibepress || { journalctl -u vibepress -n 20 --no-pager; die "The app did not start. Restore with: tar xzf $BK -C $DIR"; }
printf '\n\033[1;32mUpdated to version %s.\033[0m Hard-refresh your browser to see changes.\n' "$(cat "$SRC/VERSION")"
