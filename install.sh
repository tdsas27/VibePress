#!/usr/bin/env bash
# VibePress installer for Ubuntu 22.04 / 24.04.
# Run from the unpacked folder:   sudo ./install.sh
# Optional (skip the questions):  sudo DOMAIN=example.com EMAIL=me@example.com SITE_NAME="My Site" ./install.sh
set -euo pipefail

say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${VIBEPRESS_DIR:-/var/www/vibepress}"

[ "$(id -u)" -eq 0 ] || exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
RUN_USER="${SUDO_USER:-}"
{ [ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ]; } || die "Please log in as a normal user that has sudo (not root), then run: sudo ./install.sh"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "This installer is for Ubuntu 22.04 or 24.04."
[ -f "$DIR/app/.env" ] && die "VibePress is already installed in $DIR. To upgrade, run ./update.sh from the new release folder."

ask() {  # ask VAR "Question" "default"
  local var="$1" prompt="$2" def="${3:-}" val="${!1:-}"
  if [ -z "$val" ]; then
    read -r -p "$prompt${def:+ [$def]}: " val </dev/tty || true
    val="${val:-$def}"
  fi
  printf -v "$var" '%s' "$val"
}

say "A few questions"
ask DOMAIN "Your domain name (for example example.com)"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]] || die "That does not look like a domain name: '$DOMAIN'"
ask EMAIL "Your email (used for HTTPS certificate notices)"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "That does not look like an email address: '$EMAIL'"
ask SITE_NAME "Your site name" "My VibePress Site"
case "$SITE_NAME" in *[\"\\\$\`\#]*) die 'Please avoid the characters " \ $ ` # in the site name (you can change it later in brand.json).';; esac

say "Checking that $DOMAIN points at this server"
SERVER_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
echo "This server: ${SERVER_IP:-unknown}    $DOMAIN points to: ${DNS_IP:-nothing yet}"
HTTPS=1
if [ -z "$SERVER_IP" ] || [ "$SERVER_IP" != "$DNS_IP" ]; then
  if [ "${FORCE:-0}" = "1" ]; then
    warn "DNS is not ready, so HTTPS will be skipped (FORCE=1)."; HTTPS=0
  else
    die "Create an A record for $DOMAIN pointing to ${SERVER_IP:-the IP address of this server}, wait a few minutes, then run the installer again. (Advanced: FORCE=1 skips HTTPS.)"
  fi
fi

say "Installing system packages (nginx, certbot, tools)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx curl ca-certificates gnupg openssl rsync tar

NODE_OK=0
if command -v node >/dev/null 2>&1; then [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] && NODE_OK=1; fi
if [ "$NODE_OK" = 0 ]; then
  say "Installing Node.js 22 (from NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

say "Copying VibePress into $DIR"
mkdir -p "$DIR"/{app,site,templates,backups}
rsync -a --exclude node_modules --exclude .env --exclude data "$SRC/app/" "$DIR/app/"
rsync -a "$SRC/templates/" "$DIR/templates/"
rsync -a "$DIR/templates/static/" "$DIR/site/"
mkdir -p "$DIR"/site/{games,other,tools,apps,uploads,downloads} "$DIR/app/data"
touch "$DIR/app/data/nginx-firewall.conf"
if [ ! -f "$DIR/brand.json" ]; then
  SITE_NAME="$SITE_NAME" DOMAIN="$DOMAIN" node -e '
    const fs = require("fs"), b = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    b.name = process.env.SITE_NAME; b.domain = process.env.DOMAIN;
    fs.writeFileSync(process.argv[2], JSON.stringify(b, null, 2));' "$SRC/config/brand.example.json" "$DIR/brand.json"
fi

say "Writing settings"
ADMIN_PATH="/admin-$(openssl rand -hex 6)"
SCHEME=https; NODE_ENVIRONMENT=production
[ "$HTTPS" = 1 ] || { SCHEME=http; NODE_ENVIRONMENT=development; }
umask 077
cat > "$DIR/app/.env" <<ENV
SESSION_SECRET=$(openssl rand -hex 32)
PORT=3100
NODE_ENV=$NODE_ENVIRONMENT
ADMIN_PATH=$ADMIN_PATH
SITE_URL=$SCHEME://$DOMAIN
SITE_NAME="$SITE_NAME"
SITE_DIR=$DIR/site
UPLOAD_DIR=$DIR/site/uploads
DOWNLOAD_DIR=$DIR/site/downloads
BACKUP_DIR=$DIR/backups
BRAND_FILE=$DIR/brand.json
NGINX_ACCESS_LOG=/var/log/nginx/access.log
MAX_APP_MB=600
ENV
umask 022
chown -R "$RUN_USER":"$RUN_USER" "$DIR"
chmod 700 "$DIR/app/data" "$DIR/backups"

say "Installing the app's packages (this takes a minute)"
sudo -u "$RUN_USER" bash -c "cd '$DIR/app' && npm install --omit=dev --no-audit --no-fund"

say "Building your site pages"
sudo -u "$RUN_USER" env SITE_URL="$SCHEME://$DOMAIN" node "$DIR/app/render-site.js"
sudo -u "$RUN_USER" env BRAND_FILE="$DIR/brand.json" node "$DIR/site/scripts/build-index.js" "$DIR/site"
chmod -R a+rX "$DIR/site"

say "Setting up the web server (Nginx)"
sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__SITE_DIR__#$DIR/site#g" -e "s#__APP_DIR__#$DIR/app#g" -e "s#__ADMIN_PATH__#$ADMIN_PATH#g" -e "s#__PORT__#3100#g" \
  "$SRC/nginx/vibepress.conf.template" > /etc/nginx/sites-available/vibepress
ln -sf /etc/nginx/sites-available/vibepress /etc/nginx/sites-enabled/vibepress
systemctl enable --now nginx
nginx -t || die "Nginx did not accept the configuration. Nothing else was changed. Check the message above."
systemctl reload nginx

say "Starting VibePress as a background service"
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/vibepress.service <<UNIT
[Unit]
Description=VibePress app
After=network.target

[Service]
Type=simple
User=$RUN_USER
SupplementaryGroups=adm
WorkingDirectory=$DIR/app
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/vibepress-firewall.service <<UNIT
[Unit]
Description=Reload Nginx for VibePress firewall rules

[Service]
Type=oneshot
ExecStart=/bin/sh -c '/usr/sbin/nginx -t && /bin/systemctl reload nginx'
UNIT
cat > /etc/systemd/system/vibepress-firewall.path <<UNIT
[Unit]
Description=Watch VibePress firewall rules

[Path]
PathChanged=$DIR/app/data/nginx-firewall.conf

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/vibepress-index.service <<UNIT
[Unit]
Description=Refresh VibePress section listings

[Service]
Type=oneshot
User=$RUN_USER
Environment=BRAND_FILE=$DIR/brand.json
ExecStart=$NODE_BIN $DIR/site/scripts/build-index.js $DIR/site
UNIT
cat > /etc/systemd/system/vibepress-index.timer <<UNIT
[Unit]
Description=Refresh VibePress section listings every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now vibepress.service vibepress-firewall.path vibepress-index.timer
sleep 3
systemctl is-active --quiet vibepress.service || { journalctl -u vibepress -n 20 --no-pager; die "The app did not start. The messages above say why."; }

if [ "$HTTPS" = 1 ]; then
  say "Getting a free HTTPS certificate"
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    systemctl reload nginx
  else
    warn "Certbot could not issue the certificate. You can retry later with:  sudo certbot --nginx -d $DOMAIN"
  fi
fi

say "Create your admin account (password + two-step code)"
sudo -u "$RUN_USER" bash -c "cd '$DIR/app' && node setup-admin.js" </dev/tty || warn "Admin setup did not finish. Run it again with:  cd $DIR/app && node setup-admin.js"

ADMIN_URL="$SCHEME://$DOMAIN$ADMIN_PATH/"
umask 077
cat > "$DIR/INSTALL-INFO.txt" <<INFO
VibePress install information (keep private)
Site:        $SCHEME://$DOMAIN/
Admin:       $ADMIN_URL
Brand file:  $DIR/brand.json   (edit, then run:  sudo -u $RUN_USER node $DIR/app/render-site.js)
App folder:  $DIR/app          Site files: $DIR/site          Backups: $DIR/backups
Service:     sudo systemctl status vibepress      Logs: sudo journalctl -u vibepress -f
INFO
chown "$RUN_USER":"$RUN_USER" "$DIR/INSTALL-INFO.txt"

printf '\n\033[1;32mAll done!\033[0m\n'
echo "  Your site:   $SCHEME://$DOMAIN/"
echo "  Your admin:  $ADMIN_URL    <- bookmark this; it is saved in $DIR/INSTALL-INFO.txt"
echo
echo "Next: sign in, then open Footer (add social links and create the privacy and cookie pages), SEO, and Pages."
