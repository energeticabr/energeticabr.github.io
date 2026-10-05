#!/usr/bin/env bash
set -Eeuo pipefail
stage=$(readlink -f "${1:?Stage required}")
mode=${2:-validate}
case "$stage" in /home/opc/supplier-employment-*) ;; *) exit 1 ;; esac
test "$mode" = validate || test "$mode" = apply
exec 9>/home/opc/.energetica-deploy.lock
flock -n 9 || { echo DEPLOYMENT_LOCKED >&2; exit 1; }
app=/opt/energetica-whatsapp
build=/home/opc/energetica-build
baseline_workflow=c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54
baseline_config=5036ce110dcdaa4d3a5a382f804509ad297eae49843ad849cc87a0b2b2ef05f7
candidate_workflow=f4c323ee795dfee1a4b0e3e126acc0dfb04378fa7c927bdd4075248e9a66f675
candidate_config=a879e92f54d5cf43e31bc07190dd557a91659ebdd6bd9478b07c44f872066ccb
hashes() {
  test "$(sudo -n sha256sum "$1/worker/workflow.py" | cut -d' ' -f1)" = "$2"
  test "$(sudo -n sha256sum "$1/worker/workflow_config.json" | cut -d' ' -f1)" = "$3"
}
health() {
  sudo -n systemctl is-active energetica-whatsapp.service energetica-channel-bridge.service || return 1
  for attempt in 1 2 3 4 5; do
    if curl -fsS --max-time 10 https://163-176-171-217.sslip.io/health; then return 0; fi
    sleep 2
  done
  return 1
}
for root in "$app" "$build"; do hashes "$root" "$baseline_workflow" "$baseline_config"; done
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir -p "$stage/$label/tests"
  sudo -n cp -a "$root/worker" "$root/deploy" "$stage/$label/"
  cp "$stage/source/tests/test_workflow.py" "$stage/$label/tests/"
  sudo -n find "$root" -maxdepth 1 -type f -name '*.py' -exec cp {} "$stage/$label/" \;
  sudo -n "$app/.venv/bin/python" -B "$stage/apply_patch.py" "$stage/$label"
  hashes "$stage/$label" "$candidate_workflow" "$candidate_config"
  sudo -n env PYTHONPYCACHEPREFIX="$stage/check-cache-$label" "$app/.venv/bin/python" -m py_compile "$stage/$label/worker/workflow.py"
  sudo -n env SUPPLIER_EMPLOYMENT_SOURCE="$stage/$label" "$app/.venv/bin/python" -B "$stage/test_supplier_employment.py" >"$stage/$label-tests.log" 2>&1
  tail -n 4 "$stage/$label-tests.log"
done
if test "$mode" = validate; then echo CANDIDATES_VERIFIED; exit 0; fi
test ! -e "$stage/backup"
mkdir -m 700 "$stage/backup"
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir "$stage/backup/$label"
  sudo -n cp -p "$root/worker/workflow.py" "$root/worker/workflow_config.json" "$stage/backup/$label/"
done
deployed=0
rollback() {
  local failed=0 label root
  trap - ERR
  trap '' INT TERM
  if test "$deployed" = 1; then
    for label in app build; do
      root=$app; test "$label" = app || root=$build
      sudo -n cp -p "$stage/backup/$label/workflow.py" "$stage/backup/$label/workflow_config.json" "$root/worker/" || failed=1
    done
    sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service || failed=1
    for root in "$app" "$build"; do hashes "$root" "$baseline_workflow" "$baseline_config" || failed=1; done
    health || failed=1
    if test "$failed" = 0; then echo ROLLED_BACK_VERIFIED >&2; else echo ROLLBACK_FAILED >&2; return 1; fi
  fi
}
failure() { local status=$1; rollback || exit 1; exit "$status"; }
trap 'failure $?' ERR
trap 'failure 130' INT
trap 'failure 143' TERM
for root in "$app" "$build"; do hashes "$root" "$baseline_workflow" "$baseline_config"; done
for label in app build; do hashes "$stage/$label" "$candidate_workflow" "$candidate_config"; done
deployed=1
for label in app build; do
  root=$app; test "$label" = app || root=$build
  sudo -n cp "$stage/$label/worker/workflow.py" "$stage/$label/worker/workflow_config.json" "$root/worker/"
  hashes "$root" "$candidate_workflow" "$candidate_config"
done
sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
health
for root in "$app" "$build"; do hashes "$root" "$candidate_workflow" "$candidate_config"; done
trap - ERR INT TERM
echo SUPPLIER_EMPLOYMENT_DEPLOYED_VERIFIED
