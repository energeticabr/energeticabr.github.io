#!/usr/bin/env bash
set -euo pipefail
stage="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/energetica-whatsapp
check_live() {
  test "$(sha256sum "$app/worker/workflow.py" | cut -d' ' -f1)" = 532b9bf1d2d2495128bcf46b38bb71eadfe5d749bf1ee02b764bdb647021ae8d
  test "$(sha256sum "$app/worker/workflow_config.json" | cut -d' ' -f1)" = f4e3b69daa5be081eef4eee174d26f402e7987617876dad08745b88b7e252526
}
check_live
test "$(sha256sum "$stage/source/workflow.py" | cut -d' ' -f1)" = 920f75626121a84f31cb2cbbe2533dc0528b58aa1458a2a7914a3ead579189a9
test "$(sha256sum "$stage/source/workflow_config.json" | cut -d' ' -f1)" = 8ba5c2679be440604e81e1560e58a28f22a1a10c8478164780a80ed57a36f0fc
POSTING_LIMIT_SOURCE="$stage/source" "$app/.venv/bin/python" "$stage/test_posting_limit.py"
"$app/.venv/bin/python" -m py_compile "$stage/source/workflow.py"
backup="$app/.deploy-backups/posting-limit-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
cp -p "$app/worker/workflow.py" "$app/worker/workflow_config.json" "$backup/"
rollback() {
  cp -p "$backup/workflow.py" "$app/worker/workflow.py"
  cp -p "$backup/workflow_config.json" "$app/worker/workflow_config.json"
  systemctl restart energetica-channel-bridge.service
  echo 'Rollback aplicado.' >&2
}
trap rollback ERR
install -o root -g energetica-whatsapp -m 640 "$stage/source/workflow.py" "$app/worker/workflow.py"
install -o root -g energetica-whatsapp -m 640 "$stage/source/workflow_config.json" "$app/worker/workflow_config.json"
systemctl restart energetica-channel-bridge.service
for attempt in {1..10}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8765/health > "$stage/health.json"; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8765/health
systemctl is-active energetica-channel-bridge.service
trap - ERR
sha256sum "$app/worker/workflow.py" "$app/worker/workflow_config.json"
echo "Publicado; backup $backup"
