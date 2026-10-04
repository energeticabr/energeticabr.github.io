#!/usr/bin/env bash
set -Eeuo pipefail
stage=$(readlink -f "${1:?Stage directory required}")
mode=${2:-validate}
case "$stage" in /home/opc/launch-payroll-transport-*) ;; *) exit 1 ;; esac
test "$mode" = validate || test "$mode" = apply
exec 9>/home/opc/.energetica-deploy.lock
flock -n 9 || { echo 'Deployment locked' >&2; exit 1; }
app=/opt/energetica-whatsapp
build=/home/opc/energetica-build
baseline=c4fd1a32cce1da04f2c03f838f7a2d053a6a966f672ba9e5b15058e8435b82c2
candidate=c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54
check_hash() {
  test "$(sudo -n sha256sum "$1/worker/workflow.py" | cut -d' ' -f1)" = "$2"
}
check_baseline() { check_hash "$app" "$baseline"; check_hash "$build" "$baseline"; }
check_baseline
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir -p "$stage/$label"
  sudo -n cp -a "$root/worker" "$root/tests" "$root/deploy" "$stage/$label/"
  sudo -n find "$root" -maxdepth 1 -type f -name '*.py' -exec cp {} "$stage/$label/" \;
  sudo -n "$app/.venv/bin/python" -B "$stage/apply_verified_patch.py" "$stage/$label" "$stage/transport.patch"
  check_hash "$stage/$label" "$candidate"
  sudo -n env PYTHONPYCACHEPREFIX="$stage/compile-cache" "$app/.venv/bin/python" -m py_compile "$stage/$label/worker/workflow.py"
  sudo -n env TRANSPORT_SOURCE="$stage/$label" TRANSPORT_TESTS="$stage/test-fixtures" TRANSPORT_FIXTURE="$stage/$label-fixture.json" "$app/.venv/bin/python" -B "$stage/test_transport.py" >"$stage/$label-tests.log" 2>&1
  tail -n 4 "$stage/$label-tests.log"
  check_hash "$stage/$label" "$candidate"
done
if test "$mode" = validate; then echo CANDIDATES_VERIFIED; exit 0; fi
test ! -e "$stage/backup"
mkdir -m 700 "$stage/backup"
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir "$stage/backup/$label"
  sudo -n cp -p "$root/worker/workflow.py" "$stage/backup/$label/"
done
deployed=0
rollback() {
  if test "$deployed" = 1; then
    for label in app build; do
      root=$app; test "$label" = app || root=$build
      sudo -n cp -p "$stage/backup/$label/workflow.py" "$root/worker/workflow.py"
    done
    sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
    echo ROLLED_BACK >&2
  fi
}
trap rollback ERR
check_baseline
check_hash "$stage/app" "$candidate"
check_hash "$stage/build" "$candidate"
deployed=1
for label in app build; do
  root=$app; test "$label" = app || root=$build
  sudo -n cp "$stage/$label/worker/workflow.py" "$root/worker/workflow.py"
  check_hash "$root" "$candidate"
done
sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
sudo -n systemctl is-active energetica-whatsapp.service energetica-channel-bridge.service
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 15 https://163-176-171-217.sslip.io/health; then
    trap - ERR
    echo TRANSPORT_DEPLOYMENT_VERIFIED
    exit 0
  fi
  sleep 2
done
false
