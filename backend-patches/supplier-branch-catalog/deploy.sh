#!/usr/bin/env bash
set -euo pipefail
stage=$(readlink -f "${1:?Stage directory required}")
mode=${2:-validate}
case "$stage" in /home/opc/supplier-branch-catalog-*) ;; *) exit 1 ;; esac
test "$mode" = validate || test "$mode" = apply
exec 9>/home/opc/.energetica-deploy.lock
flock -n 9 || { echo 'Another deployment holds the lock' >&2; exit 1; }
app=/opt/energetica-whatsapp
build=/home/opc/energetica-build
check_hash() { test "$(sudo -n sha256sum "$1" | cut -d' ' -f1)" = "$2"; }
check_baseline() {
check_hash "$app/worker/workflow.py" 2330802a964b0d52c359d0cc2c3ddfab30778e52f323d8a373f23464444b3272
check_hash "$app/worker/clients.py" e2d85e5a84df0c8a8522e45398d481b34f79def2562e1b4d662d54b0f2780b62
check_hash "$build/worker/workflow.py" 2330802a964b0d52c359d0cc2c3ddfab30778e52f323d8a373f23464444b3272
check_hash "$build/worker/clients.py" 54aa0d9632d13e3f15213d9000c5e03e98722b66367919e7155fc96600baeb46
}
check_baseline
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir -p "$stage/$label/worker"
  sudo -n cp -a "$root/worker/." "$stage/$label/worker/"
  sudo -n "$app/.venv/bin/python" -B "$stage/apply_verified_patch.py" "$stage/$label" "$stage/catalog-only.patch"
  sudo -n env PYTHONPYCACHEPREFIX="$stage/compile-cache" "$app/.venv/bin/python" -m py_compile "$stage/$label/worker/clients.py" "$stage/$label/worker/workflow.py"
  sudo -n env BRANCH_CATALOG_SOURCE="$stage/$label" "$app/.venv/bin/python" -B "$stage/test_branch_catalog.py"
done
if test "$mode" = validate; then echo CANDIDATES_VERIFIED; exit 0; fi
test ! -e "$stage/backup"
mkdir -m 700 "$stage/backup"
for label in app build; do
  root=$app; test "$label" = app || root=$build
  mkdir "$stage/backup/$label"
  sudo -n cp -p "$root/worker/clients.py" "$root/worker/workflow.py" "$stage/backup/$label/"
done
deployed=0
rollback() {
  if test "$deployed" = 1; then
    for label in app build; do
      root=$app; test "$label" = app || root=$build
      sudo -n cp -p "$stage/backup/$label/clients.py" "$stage/backup/$label/workflow.py" "$root/worker/"
    done
    sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
    echo ROLLED_BACK >&2
  fi
}
trap rollback ERR
check_baseline
deployed=1
for label in app build; do
  root=$app; test "$label" = app || root=$build
  for file in clients.py workflow.py; do
    sudo -n cp "$stage/$label/worker/$file" "$root/worker/$file"
    test "$(sudo -n sha256sum "$root/worker/$file" | cut -d' ' -f1)" = "$(sudo -n sha256sum "$stage/$label/worker/$file" | cut -d' ' -f1)"
  done
done
sudo -n systemctl restart energetica-whatsapp.service energetica-channel-bridge.service
healthy=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:8080/health >/dev/null && curl -fsS --max-time 3 http://127.0.0.1:8765/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
sudo -n systemctl is-active --quiet energetica-whatsapp.service energetica-channel-bridge.service
sudo -n env BRANCH_CATALOG_SOURCE="$app" "$app/.venv/bin/python" -B "$stage/test_branch_catalog.py"
curl -fsS --max-time 15 https://163-176-171-217.sslip.io/health
sudo -n sha256sum "$app/worker/clients.py" "$app/worker/workflow.py"
trap - ERR
echo DEPLOYED_AND_HEALTHY
