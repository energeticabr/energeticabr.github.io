#!/usr/bin/env bash
set -euo pipefail
stage="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/energetica-whatsapp
target="$app/worker/workflow_config.json"
original=72ccd5c9c50d4be173cac492ab329c6a56871ed6836fba02a47b7ae8d8ce1cce
investment_tests="$stage/test_investment.py"
if ! test -f "$investment_tests"; then
  investment_tests="$stage/../financial-investment/test_investment.py"
fi
test -f "$investment_tests"
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$original"
"$app/.venv/bin/python" "$stage/install.py" "$target" "$stage/candidate.json"
env PYTHONDONTWRITEBYTECODE=1 INSTITUTION_CONFIG="$stage/candidate.json" INSTITUTION_ORIGINAL="$target" "$app/.venv/bin/python" "$stage/test_institution.py"
env PYTHONDONTWRITEBYTECODE=1 INVESTMENT_CONFIG="$stage/candidate.json" "$app/.venv/bin/python" "$investment_tests"
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$original"
backup="$app/.deploy-backups/financial-institution-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
cp -p "$target" "$backup/workflow_config.json"
rollback() {
  cp -p "$backup/workflow_config.json" "$target"
  systemctl restart energetica-channel-bridge.service
  echo 'Rollback aplicado; dados preservados.' >&2
}
trap rollback ERR
install -o root -g energetica-whatsapp -m 640 "$stage/candidate.json" "$target"
systemctl restart energetica-channel-bridge.service
for attempt in {1..15}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8765/health > "$stage/health.json" 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8765/health
systemctl is-active energetica-channel-bridge.service
trap - ERR
sha256sum "$target"
echo "Publicado; backup $backup"
