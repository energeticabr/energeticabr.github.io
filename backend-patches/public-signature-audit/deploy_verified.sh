#!/usr/bin/env bash
set -euo pipefail
staging_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
app_dir=/opt/energetica-whatsapp
python="$app_dir/.venv/bin/python"
expected_bridge=26a7c7581e906f6c78f9ce7fde07ab4e76e7fa3f2fee14a17d9519d4e0d752da
expected_caddy=0cd45b712e5789b1575efeb228d1b0db20fe2fa783581b0f306e90223311703c
check_original() {
  test "$(sha256sum "$app_dir/channel_bridge.py" | cut -d' ' -f1)" = "$expected_bridge"
  test "$(sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$expected_caddy"
}
check_original
cp "$app_dir/channel_bridge.py" "$staging_dir/channel_bridge.original.py"
"$python" "$staging_dir/patch_bridge.py" "$staging_dir/channel_bridge.original.py" "$staging_dir/channel_bridge.py"
"$python" -m py_compile "$staging_dir/channel_bridge.py" "$staging_dir/worker/signature_audit.py" "$staging_dir/worker/signature_public.py"
chmod -R a+rX "$staging_dir"
sudo -u energetica-whatsapp env PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$staging_dir:$staging_dir/worker:$app_dir/worker:$app_dir" "$python" -m unittest test_signature_public > "$staging_dir/linux-tests.log" 2>&1
tail -n 5 "$staging_dir/linux-tests.log"
"$python" - "$staging_dir/Caddyfile" <<'PY'
from pathlib import Path
import sys
text=Path('/etc/caddy/Caddyfile').read_text()
anchor='\thandle /api/demo/* {'
assert text.count(anchor)==1 and 'handle /assinaturas/*' not in text
text=text.replace(anchor, '\thandle /assinaturas/* {\n\t\treverse_proxy 127.0.0.1:8765\n\t}\n\n'+anchor)
Path(sys.argv[1]).write_text(text)
PY
/usr/local/bin/caddy validate --config "$staging_dir/Caddyfile" --adapter caddyfile
check_original
backup_dir="$app_dir/.deploy-backups/public-signature-audit-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup_dir"
cp -p "$app_dir/channel_bridge.py" "$backup_dir/channel_bridge.py"
cp -p /etc/caddy/Caddyfile "$backup_dir/Caddyfile"
rollback() {
  cp -p "$backup_dir/channel_bridge.py" "$app_dir/channel_bridge.py"
  cp -p "$backup_dir/Caddyfile" /etc/caddy/Caddyfile
  systemctl restart energetica-channel-bridge.service
  systemctl reload caddy
  echo 'Rollback aplicado; evidências preservadas.' >&2
}
trap rollback ERR
install -o root -g energetica-whatsapp -m 640 "$staging_dir/worker/signature_audit.py" "$app_dir/worker/signature_audit.py"
install -o root -g energetica-whatsapp -m 640 "$staging_dir/worker/signature_public.py" "$app_dir/worker/signature_public.py"
install -o root -g energetica-whatsapp -m 640 "$staging_dir/channel_bridge.py" "$app_dir/channel_bridge.py"
systemctl restart energetica-channel-bridge.service
for attempt in {1..10}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8765/health > "$staging_dir/health.json"; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8765/health
install -o root -g root -m 644 "$staging_dir/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy
systemctl is-active energetica-channel-bridge.service caddy
code="$(curl -sS -o "$staging_dir/public-404.json" -w '%{http_code}' --max-time 15 https://163-176-171-217.sslip.io/assinaturas/00000000000000000000000000000000/0000000000000000000000000000000000000000000000000000000000000000)"
test "$code" = 404
trap - ERR
sha256sum "$app_dir/channel_bridge.py" "$app_dir/worker/signature_audit.py" "$app_dir/worker/signature_public.py" /etc/caddy/Caddyfile
printf 'Backend publicado; rota pública respondeu %s; backup %s\n' "$code" "$backup_dir"
