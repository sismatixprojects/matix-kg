#!/usr/bin/env bash
# Installs the Matix KG ID/relay server (RustDesk hbbs/hbbr) as systemd services.
# Usage (as root on a Linux x86_64/arm64 host):  ./install.sh kg-id.matix.one  (a DNS-only name)
set -euo pipefail

HOST="${1:?usage: install.sh <public-hostname>}"
VERSION="${SERVER_VERSION:-1.1.16}"
PREFIX=/opt/matix-kg
DATA=/var/lib/matix-kg
USER_NAME=matixkg

case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64) ARCH=arm64v8 ;;
  *) echo "unsupported arch $(uname -m)"; exit 1 ;;
esac

id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$USER_NAME"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0750 "$DATA"
install -d "$PREFIX/bin"

tmp=$(mktemp -d)
curl -fsSL -o "$tmp/server.zip" "https://github.com/rustdesk/rustdesk-server/releases/download/${VERSION}/rustdesk-server-linux-${ARCH}.zip"
(cd "$tmp" && unzip -q server.zip)
install -m 0755 "$(find "$tmp" -name hbbs -type f | head -1)" "$PREFIX/bin/hbbs"
install -m 0755 "$(find "$tmp" -name hbbr -type f | head -1)" "$PREFIX/bin/hbbr"
rm -rf "$tmp"

# If you generated the key pair elsewhere, put id_ed25519 / id_ed25519.pub in $DATA first
# (mode 0600, owned by matixkg). Otherwise hbbr creates one on first start.
cat > /etc/systemd/system/matix-kg-hbbr.service <<UNIT
[Unit]
Description=Matix KG relay server (hbbr)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DATA
ExecStart=$PREFIX/bin/hbbr -k _
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/matix-kg-hbbs.service <<UNIT
[Unit]
Description=Matix KG ID server (hbbs)
After=network-online.target matix-kg-hbbr.service
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DATA
ExecStart=$PREFIX/bin/hbbs -r $HOST:21117 -k _
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now matix-kg-hbbr.service
sleep 1
systemctl enable --now matix-kg-hbbs.service
for i in $(seq 1 20); do [ -s "$DATA/id_ed25519.pub" ] && break; sleep 0.5; done

cat <<MSG

Matix KG server is running.
  Public key (goes into the web client's config.json and the customer app build):
    $(cat "$DATA/id_ed25519.pub")

Firewall: open TCP 21115-21117 and UDP 21116 to the internet.
          Keep TCP 21118-21119 closed to the internet: only the local TLS proxy may reach them
          (hbbs/hbbr trust the X-Real-IP header on those ports).
Next: put nginx.conf (or apache.conf) in front for https://$HOST/web and wss://$HOST/ws/*.
MSG
