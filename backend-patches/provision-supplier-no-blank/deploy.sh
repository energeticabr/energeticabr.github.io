#!/usr/bin/env bash
set -Eeuo pipefail
stage=$(readlink -f "${1:?Stage directory required}")
mode=${2:-validate}
case "$stage" in /home/opc/provision-supplier-no-blank-*) ;; *) exit 1 ;; esac
test "$mode" = validate || test "$mode" = apply
exec 9>/home/opc/.energetica-deploy.lock
flock -n 9 || { echo 'Deployment locked' >&2; exit 1; }
app=/opt/energetica-whatsapp
build=/home/opc/energetica-build
baseline=008558f341ec19930858be622ee11ff4f1ef554e34e4e86694a0298652dddf4d
candidate=5036ce110dcdaa4d3a5a382f804509ad297eae49843ad849cc87a0b2b2ef05f7
workflow=c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54
check_hash() { test "$(sudo -n sha256sum "$1/worker/workflow_config.json" | cut -d' ' -f1)" = "$2"; }
check_workflow() { test "$(sudo -n sha256sum "$1/worker/workflow.py" | cut -d' ' -f1)" = "$workflow"; }
check_baseline() { for root in "$app" "$build"; do check_hash "$root" "$baseline"; check_workflow "$root"; done; }
check_services_health() {
  sudo -n systemctl is-active energetica-whatsapp.service energetica-channel-bridge.service || return 1
  for attempt in 1 2 3 4 5; do
    if curl -fsS --max-time 10 https://163-176-171-217.sslip.io/health; then return 0; fi
    sleep 2
  done
  return 1
}
check_baseline
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir -p "$stage/$label"
  sudo -n cp -a "$root/worker" "$root/deploy" "$stage/$label/"
  mkdir -p "$stage/$label/tests"
  cp "$stage/test-fixtures/test_workflow.py" "$stage/$label/tests/test_workflow.py"
  sudo -n find "$root" -maxdepth 1 -type f -name '*.py' -exec cp {} "$stage/$label/" \;
  sudo -n "$app/.venv/bin/python" -B "$stage/patch_configuration.py" "$stage/$label"
  check_hash "$stage/$label" "$candidate"
  sudo -n env PROVISION_SOURCE="$stage/$label" PROVISION_FIXTURE="$stage/$label-fixture.json" "$app/.venv/bin/python" -B "$stage/test_supplier.py" >"$stage/$label-tests.log" 2>&1
  tail -n 4 "$stage/$label-tests.log"
done
if test "$mode" = validate; then echo CANDIDATES_VERIFIED; exit 0; fi
test ! -e "$stage/backup"
mkdir -m 700 "$stage/backup"
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir "$stage/backup/$label"
  sudo -n cp -p "$root/worker/workflow_config.json" "$stage/backup/$label/"
done
deployed=0
rollback() {
  local recovery_failed=0 label root
  trap - ERR
  trap '' INT TERM
  if test "$deployed" = 1; then
    for label in app build; do
      root=$app; test "$label" = app || root=$build
      sudo -n cp -p "$stage/backup/$label/workflow_config.json" "$root/worker/workflow_config.json" || recovery_failed=1
    done
    sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service || recovery_failed=1
    for root in "$app" "$build"; do
      check_hash "$root" "$baseline" || recovery_failed=1
      check_workflow "$root" || recovery_failed=1
    done
    check_services_health || recovery_failed=1
    if test "$recovery_failed" = 0; then
      echo ROLLED_BACK_VERIFIED >&2
    else
      echo "ROLLBACK_FAILED: inspect backups at $stage/backup" >&2
      return 1
    fi
  fi
}
on_failure() {
  local status=$1
  rollback || exit 1
  exit "$status"
}
trap 'on_failure $?' ERR
trap 'on_failure 130' INT
trap 'on_failure 143' TERM
check_baseline
for label in app build; do check_hash "$stage/$label" "$candidate"; done
deployed=1
for label in app build; do
  root=$app; test "$label" = app || root=$build
  sudo -n cp "$stage/$label/worker/workflow_config.json" "$root/worker/workflow_config.json"
  check_hash "$root" "$candidate"
done
sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
check_services_health
for root in "$app" "$build"; do check_hash "$root" "$candidate"; check_workflow "$root"; done
trap - ERR INT TERM
echo SUPPLIER_NO_BLANK_DEPLOYMENT_VERIFIED
