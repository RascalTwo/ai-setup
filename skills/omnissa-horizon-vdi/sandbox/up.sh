#!/bin/sh
# Starts the VDI sandbox and prints its URL. Login: user "claude", password in $STATE/guac-pass.
set -eu
STATE="$HOME/.agents/state/vdi-sandbox"
mkdir -p "$STATE/guac-home"
[ -s "$STATE/guac-pass" ] || { openssl rand -hex 8 > "$STATE/guac-pass"; chmod 600 "$STATE/guac-pass"; }
cat > "$STATE/guac-home/user-mapping.xml" <<XML
<user-mapping>
  <authorize username="claude" password="$(cat "$STATE/guac-pass")">
    <connection name="linux-desktop">
      <protocol>rdp</protocol>
      <param name="hostname">desktop</param>
      <param name="port">3389</param>
      <param name="username">abc</param>
      <param name="password">abc</param>
      <param name="ignore-cert">true</param>
      <param name="security">any</param>
    </connection>
  </authorize>
</user-mapping>
XML
docker compose -p vdi-sandbox -f "$(dirname "$0")/compose.yaml" up -d
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8088/guacamole/)" = 200 ]; do sleep 2; done
echo "http://127.0.0.1:8088/guacamole/"
