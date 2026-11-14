#!/usr/bin/env bash
set -euo pipefail

package="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ "$EUID" == 0 && "$package" == /var/lib/energetica-deploy/nb-ios ]]
[[ -z "$(find "$package" -maxdepth 0 \( ! -user root -o -perm /022 \) -print)" ]]
[[ -z "$(find "$package" -maxdepth 1 -type f \( ! -user root -o -perm /022 \) -print)" ]]

python=/opt/energetica-whatsapp/.venv/bin/python
roots=(/opt/energetica-whatsapp /home/opc/energetica-build)
files=(channel_bridge.py worker/workflow.py)
backup="$(mktemp -d "$package/deploy.XXXXXXXX")"
exec 9>"$package/deploy.lock"
flock -n 9

for index in "${!roots[@]}"; do
  root="${roots[$index]}"
  mkdir -p "$backup/$index/original/worker"
  sha256sum "$root/channel_bridge.py" "$root/worker/workflow.py" \
    "$root/worker/workflow_config.json" > "$backup/$index/baseline"
  for relative in "${files[@]}"; do
    cp -a -- "$root/$relative" "$backup/$index/original/$relative"
  done
  "$python" -B "$package/test_candidate.py" "$root"
  "$python" -B "$package/candidate.py" "$root" "$backup/$index/updated"
done

gate=/var/lib/energetica-deploy/launch-order-cleanup-20261111/deployment_gate.sh
test "$(sha256sum "$gate" | cut -d ' ' -f 1)" = ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6
source "$gate"

restore() {
  for index in "${!roots[@]}"; do
    for relative in "${files[@]}"; do
      cp -a -- "$backup/$index/original/$relative" "${roots[$index]}/$relative"
    done
  done
  systemctl restart energetica-channel-bridge
}
changed=0
cleanup() {
  local status=$?
  if (( status != 0 && changed == 1 )); then
    restore || printf 'Falha ao restaurar. Backup em %s\n' "$backup" >&2
  fi
  diary_release_ingress
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

diary_block_ingress
diary_drain_requests
for index in "${!roots[@]}"; do
  sha256sum -c "$backup/$index/baseline"
done
changed=1
for index in "${!roots[@]}"; do
  for relative in "${files[@]}"; do
    target="${roots[$index]}/$relative"
    staged="$(mktemp "$(dirname "$target")/.nb-ios.XXXXXXXX")"
    cp -a -- "$target" "$staged"
    cat "$backup/$index/updated/$relative" > "$staged"
    mv -T -- "$staged" "$target"
    cmp -s "$backup/$index/updated/$relative" "$target"
  done
done

systemctl restart energetica-channel-bridge
for attempt in {1..55}; do
  if curl -fs --max-time 1 http://127.0.0.1:8765/health; then break; fi
  [[ "$attempt" != 55 ]]
  sleep 1
done
for endpoint in chat upload transcribe; do
  curl -fsS -D - -o /dev/null -X OPTIONS -H 'Origin: capacitor://localhost' \
    -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: x-portal-app' \
    "http://127.0.0.1:8765/portal/$endpoint" | grep -iE '^Access-Control-Allow-Headers:.*X-Portal-App'
done
systemctl is-active energetica-channel-bridge energetica-whatsapp
printf '\nBackup: %s\n' "$backup"
