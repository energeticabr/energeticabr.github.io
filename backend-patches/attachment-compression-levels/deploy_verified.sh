#!/usr/bin/env bash
set -euo pipefail
stage="$(cd -- "$(dirname -- "$0")" && pwd)"
app=/opt/energetica-whatsapp
python="$app/.venv/bin/python"
check_live() {
  test "$(sha256sum "$app/worker/compression.py" | cut -d' ' -f1)" = e3fef6adf8f0dc147f39c6268de46eb830ae55171713c4cd01af9f8dd1280b40
  test "$(sha256sum "$app/worker/workflow.py" | cut -d' ' -f1)" = df1dafad72ef790229df2e05647a9a1bf7e6e1b344952064cbdc1c56f4b0decb
  test "$(sha256sum "$app/channel_bridge.py" | cut -d' ' -f1)" = 28b4f8f6e27e0b26fe2442925fb0f6087823c21b1fc75678f605f8175ea4ac47
}
check_live
mkdir -p "$stage/source"
cp "$app/worker/compression.py" "$app/worker/workflow.py" "$app/channel_bridge.py" "$stage/source/"
"$python" "$stage/install.py" "$stage/source" --check
"$python" "$stage/install.py" "$stage/source"
COMPRESSION_BACKEND_SOURCE="$stage/source" "$python" "$stage/test_levels.py" > "$stage/linux-tests.log" 2>&1
tail -n 5 "$stage/linux-tests.log"
"$python" -m py_compile "$stage/source/compression.py" "$stage/source/workflow.py" "$stage/source/channel_bridge.py"
check_live
backup="$app/.deploy-backups/compression-levels-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
cp -p "$app/worker/compression.py" "$app/worker/workflow.py" "$app/channel_bridge.py" "$backup/"
rollback() {
  cp -p "$backup/compression.py" "$app/worker/compression.py"
  cp -p "$backup/workflow.py" "$app/worker/workflow.py"
  cp -p "$backup/channel_bridge.py" "$app/channel_bridge.py"
  systemctl restart energetica-channel-bridge.service
  echo 'Rollback aplicado; originais e evidências preservados.' >&2
}
trap rollback ERR
install -o root -g energetica-whatsapp -m 640 "$stage/source/compression.py" "$app/worker/compression.py"
install -o root -g energetica-whatsapp -m 640 "$stage/source/workflow.py" "$app/worker/workflow.py"
install -o root -g energetica-whatsapp -m 640 "$stage/source/channel_bridge.py" "$app/channel_bridge.py"
systemctl restart energetica-channel-bridge.service
for attempt in {1..10}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8765/health > "$stage/health.json"; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8765/health
systemctl is-active energetica-channel-bridge.service
trap - ERR
sha256sum "$app/worker/compression.py" "$app/worker/workflow.py" "$app/channel_bridge.py"
echo "Backend publicado; backup $backup"
