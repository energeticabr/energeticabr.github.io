#!/usr/bin/env bash
set -euo pipefail
stage="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/energetica-whatsapp
target="$app/worker/signature_public.py"
original=c77afb941a4f910fe043d5a8a801d6a663571a88f69c6d291c4935322f637ab8
updated=a7b9d8005b09cdd99270f71ad8a9faf89d9de2233dc0be5ed973d21e5534be2d
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
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$updated"
trap - ERR
sha256sum "$target"
echo "Publicado; backup $backup"
