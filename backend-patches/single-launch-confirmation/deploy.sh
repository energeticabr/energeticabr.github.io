#!/usr/bin/env bash
set -Eeuo pipefail
stage=$(readlink -f "${1:?Stage directory required}")
mode=${2:-validate}
case "$stage" in /home/opc/single-launch-confirmation-*) ;; *) exit 1 ;; esac
test "$mode" = validate || test "$mode" = apply
exec 9>/home/opc/.energetica-deploy.lock
flock -n 9 || { echo 'Deployment locked' >&2; exit 1; }
app=/opt/energetica-whatsapp
build=/home/opc/energetica-build
baseline=4c160f51201cecce19169144aa59e47fec577880002c26ac0b7da9c659ae9dfa
controls_baseline=2213da9b9c0ad571bc1c301fa8c77c470cf66a28d0c8000e8a75258ce351bfbf
preview_candidate=bd5d57b4a0578d1d207d5515831b4cd5af05383ba8b5b3dfe8c0b58129942268
controls_candidate=699dfe299d219241ba59c3abc03c81008c089dc31ff0368281ca8f2cf7139993
check_candidates() {
  test "$(sudo -n sha256sum "$1/worker/launch_preview.py" | cut -d' ' -f1)" = "$preview_candidate"
  test "$(sudo -n sha256sum "$1/worker/launch_line_controls.py" | cut -d' ' -f1)" = "$controls_candidate"
}
check_baseline() {
  for root in "$app" "$build"; do
    test "$(sudo -n sha256sum "$root/worker/launch_preview.py" | cut -d' ' -f1)" = "$baseline"
    test "$(sudo -n sha256sum "$root/worker/launch_line_controls.py" | cut -d' ' -f1)" = "$controls_baseline"
  done
}
check_baseline
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir -p "$stage/$label"
  sudo -n cp -a "$root/worker" "$root/tests" "$root/deploy" "$stage/$label/"
  sudo -n find "$root" -maxdepth 1 -type f -name '*.py' -exec cp {} "$stage/$label/" \;
  sudo -n "$app/.venv/bin/python" -B "$stage/apply_verified_patch.py" "$stage/$label" "$stage/single-confirmation.patch"
  check_candidates "$stage/$label"
  sudo -n env PYTHONPYCACHEPREFIX="$stage/compile-cache" "$app/.venv/bin/python" -m py_compile "$stage/$label/worker/launch_preview.py" "$stage/$label/worker/launch_line_controls.py"
  sudo -n env SINGLE_LAUNCH_SOURCE="$stage/$label" SINGLE_LAUNCH_TESTS="$stage/test-fixtures" "$app/.venv/bin/python" -B "$stage/test_single_launch.py" >"$stage/$label-tests.log" 2>&1
  tail -n 4 "$stage/$label-tests.log"
  check_candidates "$stage/$label"
done
if test "$mode" = validate; then echo CANDIDATES_VERIFIED; exit 0; fi
test ! -e "$stage/backup"
mkdir -m 700 "$stage/backup"
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir "$stage/backup/$label"
  sudo -n cp -p "$root/worker/launch_preview.py" "$root/worker/launch_line_controls.py" "$stage/backup/$label/"
done
deployed=0
rollback() {
  if test "$deployed" = 1; then
    for label in app build; do
      root=$app; test "$label" = app || root=$build
      sudo -n cp -p "$stage/backup/$label/launch_preview.py" "$stage/backup/$label/launch_line_controls.py" "$root/worker/"
    done
    sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
    echo ROLLED_BACK >&2
  fi
}
trap rollback ERR
check_baseline
check_candidates "$stage/app"
check_candidates "$stage/build"
deployed=1
for label in app build; do
  root=$app; test "$label" = app || root=$build
  sudo -n cp "$stage/$label/worker/launch_preview.py" "$stage/$label/worker/launch_line_controls.py" "$root/worker/"
  check_candidates "$root"
done
sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
healthy=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:8080/health >/dev/null && curl -fsS --max-time 3 http://127.0.0.1:8765/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
sudo -n systemctl is-active --quiet energetica-whatsapp.service energetica-channel-bridge.service
sudo -n env SINGLE_LAUNCH_SOURCE="$app" SINGLE_LAUNCH_TESTS="$stage/test-fixtures" SINGLE_LAUNCH_FIXTURE="$stage/live-single-confirmation.json" "$app/.venv/bin/python" -B "$stage/test_single_launch.py" >"$stage/live-tests.log" 2>&1
tail -n 4 "$stage/live-tests.log"
curl -fsS --max-time 15 https://163-176-171-217.sslip.io/health
check_candidates "$app"
check_candidates "$build"
sudo -n sha256sum "$app/worker/launch_preview.py" "$app/worker/launch_line_controls.py"
trap - ERR
echo DEPLOYED_AND_HEALTHY
