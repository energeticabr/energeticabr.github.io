#!/usr/bin/env bash
set -euo pipefail
stage="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/energetica-whatsapp
target="$app/worker/workflow_config.json"
original=8fbf00bfd699d680d33a1f72f06a5bed5461221145d11aa7c72eb4be884c153f
suite_path() {
  local name="$1" folder="$2"
  if test -f "$stage/$name"; then
    echo "$stage/$name"
  else
    test -f "$stage/../$folder/$name"
    echo "$stage/../$folder/$name"
  fi
}
institution_tests="$(suite_path test_institution.py financial-institution)"
investment_tests="$(suite_path test_investment.py financial-investment)"
type_tests="$(suite_path test_investment_type.py financial-investment-type)"
test -f "$institution_tests"
test -f "$investment_tests"
test -f "$type_tests"
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$original"
"$app/.venv/bin/python" "$stage/install.py" "$target" "$stage/candidate.json"
env PYTHONDONTWRITEBYTECODE=1 PROFITABILITY_CONFIG="$stage/candidate.json" PROFITABILITY_ORIGINAL="$target" "$app/.venv/bin/python" "$stage/test_profitability.py"
env PYTHONDONTWRITEBYTECODE=1 INVESTMENT_TYPE_CONFIG="$stage/candidate.json" INVESTMENT_TYPE_ORIGINAL="$target" "$app/.venv/bin/python" "$type_tests"
env PYTHONDONTWRITEBYTECODE=1 INSTITUTION_CONFIG="$stage/candidate.json" INSTITUTION_ORIGINAL="$target" "$app/.venv/bin/python" "$institution_tests"
env PYTHONDONTWRITEBYTECODE=1 INVESTMENT_CONFIG="$stage/candidate.json" "$app/.venv/bin/python" "$investment_tests"
test "$(sha256sum "$target" | cut -d' ' -f1)" = "$original"
backup="$app/.deploy-backups/financial-profitability-$(date -u +%Y%m%dT%H%M%SZ)"
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
