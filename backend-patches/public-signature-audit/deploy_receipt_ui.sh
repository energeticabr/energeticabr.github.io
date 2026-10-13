#!/usr/bin/env bash
set -euo pipefail
stage="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/energetica-whatsapp
target="$app/worker/signature_public.py"
original=a7b9d8005b09cdd99270f71ad8a9faf89d9de2233dc0be5ed973d21e5534be2d
updated=3265388ddb98eec752144989370887d523c7430e06241bea2d0ea75bed8eb82d
exec 9>/tmp/energetica-whatsapp-deploy.lock
flock -n 9
test -f "$target" && test ! -L "$target"
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$original"
test "$(sha256sum "$stage/worker/signature_public.py" | cut -d' ' -f1)" = "$updated"
"$app/.venv/bin/python" -m py_compile "$stage/worker/signature_public.py"
backup="$app/.deploy-backups/signature-receipt-ui-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
cp -p "$target" "$backup/signature_public.py"
rollback() {
  cp -p "$backup/signature_public.py" "$target"
  systemctl restart energetica-channel-bridge.service
  echo 'Rollback aplicado; registros preservados.' >&2
}
trap rollback ERR
install -o root -g energetica-whatsapp -m 640 "$stage/worker/signature_public.py" "$target"
systemctl restart energetica-channel-bridge.service
for attempt in {1..15}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8765/health > "$stage/health.json" 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8765/health
systemctl is-active energetica-channel-bridge.service
systemctl is-active energetica-whatsmeow.service
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$updated"
trap - ERR
sha256sum "$target"
echo "Publicado; backup $backup"
