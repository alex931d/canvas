#!/usr/bin/env bash
# Build and start canvas on this server: the first time and after every
# update. From the canvas folder:
#
#   bash deploy/deploy.sh             pull the latest code, back up, rebuild, restart
#   bash deploy/deploy.sh --no-pull   the same with the code as it is here
#
# The first run only creates deploy/.env (with a database password) for you
# to fill in. Database changes (migrations) are applied when the app starts.
set -euo pipefail
cd "$(dirname "$0")"

pull=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) pull=0 ;;
    *)
      echo "Unknown option: $arg (try --no-pull)" >&2
      exit 1
      ;;
  esac
done

fail() {
  echo "✗ $*" >&2
  exit 1
}
setting() { sed -n "s/^$1=//p" .env | tail -1 | sed 's/^"\(.*\)"$/\1/'; }

docker info >/dev/null 2>&1 || fail "Can't use Docker. Run deploy/setup-vps.sh first, or log in again (or use sudo) so you're in the docker group."

# ---------------------------------------------------------------- settings
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  password=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${password}/" .env
  echo "Created deploy/.env with a database password."
  echo "Fill in DOMAIN, Stripe and email there (nano deploy/.env), then run this again."
  exit 0
fi

domain=$(setting DOMAIN)
[ -n "$domain" ] && [ "$domain" != canvas.example.com ] || fail "Set DOMAIN in deploy/.env to your domain."
[[ "$(setting POSTGRES_PASSWORD)" =~ ^[A-Za-z0-9]{16,}$ ]] ||
  fail "POSTGRES_PASSWORD in deploy/.env must be at least 16 letters and digits (openssl rand -hex 24 makes one)."
for name in STRIPE_SECRET_KEY STRIPE_PRICE_ID STRIPE_WEBHOOK_SECRET SMTP_URL; do
  case "$name" in STRIPE_*) what="memberships" ;; *) what="emails (sign-up codes, password resets)" ;; esac
  [ -n "$(setting "$name")" ] || echo "! $name is empty in deploy/.env: $what won't work until it's set."
done
getent ahosts "$domain" >/dev/null || echo "! $domain doesn't resolve yet: point its DNS at this server, or HTTPS can't start."

# -------------------------------------------------------------------- code
if [ "$pull" = 1 ] && git -C .. rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
  echo "== Pulling the latest code"
  git -C .. pull --ff-only
fi
DEPLOYMENT_ID=$(git -C .. rev-parse --short HEAD 2>/dev/null || date +%s)
export DEPLOYMENT_ID

# ----------------------------------------------------------------- backup
if docker compose ps --status running --services 2>/dev/null | grep -qx backup; then
  echo "== Backing up the database first"
  docker compose exec -T backup sh /backup/backup.sh || fail "The backup failed, so nothing was changed. See above."
fi

# ------------------------------------------------------------ build & run
echo "== Building version ${DEPLOYMENT_ID} (a few minutes)"
docker compose build app
echo "== Starting"
if ! docker compose up -d --remove-orphans --wait --wait-timeout 300; then
  docker compose ps
  docker compose logs --tail 60 app
  fail "Something didn't start: see the logs above (docker compose logs app, from deploy/)."
fi
docker image prune -f >/dev/null

echo "✓ canvas ${DEPLOYMENT_ID} is running: https://${domain}"
echo "  (The first start gets the HTTPS certificate, which can take a minute.)"
