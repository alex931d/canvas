#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu or Debian server for canvas:
#   - Docker and Docker Compose, from Docker's own packages
#   - a firewall that lets in only SSH, HTTP and HTTPS
#   - 2 GB of swap if there's none (building the app needs the memory)
#   - automatic security updates
#
#   sudo bash deploy/setup-vps.sh
#
# Safe to run again. It doesn't touch your SSH settings: if SSH listens on a
# port other than 22, allow it first (sudo ufw allow <port>/tcp).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash deploy/setup-vps.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}" in
  ubuntu | debian) ;;
  *)
    echo "This script knows Ubuntu and Debian; this is ${PRETTY_NAME:-unknown}." >&2
    echo "Install Docker (docs.docker.com/engine/install) and a firewall yourself, then run deploy/deploy.sh." >&2
    exit 1
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
step() { printf '\n== %s\n' "$*"; }

step "System updates"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git openssl ufw unattended-upgrades

step "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "Already installed: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  if apt-get update -q && apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
    :
  else
    # A release too new for Docker's packages: use the distribution's own.
    echo "Docker's packages aren't available for ${PRETTY_NAME} yet; using ${ID}'s."
    rm -f /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker.io docker-buildx docker-compose-v2 ||
      apt-get install -yq docker.io docker-compose
  fi
  docker compose version >/dev/null || { echo "Docker Compose didn't install; see docs.docker.com/engine/install." >&2; exit 1; }
fi
systemctl enable --now docker
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != root ]; then
  usermod -aG docker "${SUDO_USER}"
  echo "${SUDO_USER} can use docker without sudo after logging in again."
fi

step "Firewall: SSH, HTTP and HTTPS only"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null # HTTP/3
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'
# Docker publishes container ports past ufw, which is why compose.yml
# publishes only Caddy's 80 and 443, never the database or Redis.

step "Swap"
if swapon --show --noheadings | grep -q .; then
  echo "Already on: $(swapon --show --noheadings | awk '{print $1, $3}')"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "2 GB swap file added."
fi

step "Automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
echo "On."

step "Done"
echo "Next: cd into the canvas folder and run  bash deploy/deploy.sh"
