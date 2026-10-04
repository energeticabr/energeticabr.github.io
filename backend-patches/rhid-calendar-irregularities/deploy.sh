#!/usr/bin/env bash
set -euo pipefail
stage=/home/opc/rhid-calendar-irregular-20261003
target=/opt/energetica-whatsapp
expected=cfc8c66f3205d10566aff6cb242b747e0fdd3fd392c50355a1cf87c7a2bc9157
actual=$(sudo -n sha256sum "$target/channel_bridge.py" | cut -d' ' -f1)
test "$actual" = "$expected" || { echo 'Bridge changed; refuse stale deployment'; exit 1; }
sudo -n test ! -e "$target/rhid_calendar_snapshot.py" || { echo 'Snapshot module already exists; inspect first'; exit 1; }
test "$(sha256sum "$stage/channel_bridge.next.py" | cut -d' ' -f1)" = de70a510201cd3079975578a5be17474531080b0c4b46bde2ac615aafab29686
PYTHONPYCACHEPREFIX="$stage/check-cache-opc" python3 -m py_compile "$stage/channel_bridge.next.py" "$stage/rhid_calendar_snapshot.py"
RHID_BRIDGE_SOURCE="$stage/channel_bridge.next.py" PYTHONPATH="$stage" python3 "$stage/test_calendar.py"
backup="$target/channel_bridge.py.bak-20261003-calendar-irregular"
sudo -n test ! -e "$backup" || { echo 'Backup exists; refuse overwrite'; exit 1; }
sudo -n cp -p "$target/channel_bridge.py" "$backup"
rollback() {
  sudo -n cp -p "$backup" "$target/channel_bridge.py"
  sudo -n systemctl restart energetica-channel-bridge.service
  echo 'Bridge rolled back; unused snapshot module retained for inspection'
}
trap rollback ERR
sudo -n install -o energetica-whatsapp -g energetica-whatsapp -m 644 "$stage/rhid_calendar_snapshot.py" "$target/rhid_calendar_snapshot.py"
sudo -n install -o energetica-whatsapp -g energetica-whatsapp -m 644 "$stage/channel_bridge.next.py" "$target/channel_bridge.py"
sudo -n systemctl restart energetica-channel-bridge.service
healthy=0
for attempt in $(seq 1 15); do
  if curl --fail --silent http://127.0.0.1:8765/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
sudo -n systemctl is-active --quiet energetica-channel-bridge.service
sudo -n sha256sum "$target/channel_bridge.py" "$target/rhid_calendar_snapshot.py"
trap - ERR
echo 'RHID calendar snapshot deployed and healthy'
