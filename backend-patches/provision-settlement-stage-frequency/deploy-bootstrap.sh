#!/usr/bin/env bash
set -euo pipefail

ENTRY=/usr/local/sbin/provision-settlement-stage-frequency-deploy
PACKAGE=${1:-}
MANIFEST_SHA=${2:-}
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/provision-settlement-stage-frequency-20261124-r2/release ]]
[[ "$(readlink -f -- "${BASH_SOURCE[0]}")" == "$ENTRY" ]]
[[ ! -L "$ENTRY" ]]
read -r entry_uid entry_mode < <(stat -c '%u %a' "$ENTRY")
[[ "$entry_uid" == 0 ]]
(( (8#$entry_mode & 022) == 0 ))
[[ "$(id -u)" == 0 ]]
[[ "$#" == 2 ]]
[[ "$MANIFEST_SHA" =~ ^[0-9a-f]{64}$ ]]

umask 077
SNAPSHOT="$(mktemp -d /run/provision-stage-frequency.XXXXXXXX)"
chmod 700 "$SNAPSHOT"
WATCHDOG_ARMED=0
GATE_ACTIVE=0
PROVISION_STAGE_FREQUENCY_GATE_UNIT="provision-stage-frequency-release-$$"
PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK="$SNAPSHOT/transaction.lock"
PROVISION_STAGE_FREQUENCY_SNAPSHOT="$SNAPSHOT"
cleanup() {
  local remove_snapshot=1
  if declare -F provision_stage_frequency_release_ingress >/dev/null; then
    if ! provision_stage_frequency_release_ingress; then
      remove_snapshot=0
    fi
  fi
  if [[ "$remove_snapshot" == 1 ]]; then
    rm -rf -- "$SNAPSHOT"
  else
    echo "Ingress watchdog retained with its transaction lock at $SNAPSHOT" >&2
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# Authenticate the manifest first, then verify each root-owned snapshot file.
install -m 600 -- "$PACKAGE/deploy-manifest.json" "$SNAPSHOT/deploy-manifest.json"
ACTUAL_MANIFEST_SHA="$(sha256sum "$SNAPSHOT/deploy-manifest.json")"
[[ "${ACTUAL_MANIFEST_SHA%% *}" == "$MANIFEST_SHA" ]]
EXPECTED_INPUTS="$("$PYTHON" -B -c 'import json,sys; print("\n".join(k+" "+v for k,v in sorted(json.load(open(sys.argv[1]))["inputs"].items())))' "$SNAPSHOT/deploy-manifest.json")"
while read -r relative expected_sha; do
  [[ -n "$relative" && "$relative" != */* && "$expected_sha" =~ ^[0-9a-f]{64}$ ]]
  case "$relative" in
    deploy.py|deployment_gate.sh|patch_backend.py|shared-deploy.py|source.patch) ;;
    *) echo "Unexpected package input: $relative" >&2; exit 1 ;;
  esac
  install -m 600 -- "$PACKAGE/$relative" "$SNAPSHOT/$relative"
  actual_sha="$(sha256sum "$SNAPSHOT/$relative")"
  [[ "${actual_sha%% *}" == "$expected_sha" ]]
done <<< "$EXPECTED_INPUTS"

# The lock FD is inherited by the Python transaction, so the watchdog cannot
# release ingress while either this launcher or a child installer is alive.
exec 9>"$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK"
flock -n 9
PROVISION_STAGE_FREQUENCY_STAGE="$SNAPSHOT" \
  "$PYTHON" -B "$SNAPSHOT/deploy.py" --check "$MANIFEST_SHA"

source "$SNAPSHOT/deployment_gate.sh"
provision_stage_frequency_block_ingress
provision_stage_frequency_drain_requests
PROVISION_STAGE_FREQUENCY_GATE=$$ \
  PROVISION_STAGE_FREQUENCY_STAGE="$SNAPSHOT" \
  PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK="$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK" \
  "$PYTHON" -B "$SNAPSHOT/deploy.py" --deploy "$MANIFEST_SHA"
