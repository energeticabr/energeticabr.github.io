#!/usr/bin/env bash
set -euo pipefail

ENTRY=/usr/local/sbin/provision-settlement-stage-frequency-deploy
PACKAGE=${1:-}
MANIFEST_SHA=${2:-}
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/provision-settlement-stage-frequency-20261124-r2/release ]]
[[ "$(readlink -f -- "${BASH_SOURCE[0]}")" == "$ENTRY" ]]
[[ ! -L "$ENTRY" ]]
[[ ! -L /usr/local/sbin ]]
read -r entry_uid entry_mode entry_links < <(stat -c '%u %a %h' "$ENTRY")
read -r directory_uid directory_mode < <(stat -c '%u %a' /usr/local/sbin)
[[ "$entry_uid" == 0 && "$entry_links" == 1 && "$directory_uid" == 0 ]]
(( (8#$entry_mode & 022) == 0 && (8#$directory_mode & 022) == 0 ))
[[ "$(id -u)" == 0 ]]
[[ "$#" == 2 ]]
[[ "$MANIFEST_SHA" =~ ^[0-9a-f]{64}$ ]]

umask 077
SNAPSHOT="$(mktemp -d /run/provision-stage-frequency.XXXXXXXX)"
chmod 700 "$SNAPSHOT"
TRANSACTION_FD_OPEN=0
PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=0
PROVISION_STAGE_FREQUENCY_GATE_UNIT="provision-stage-frequency-release-$$"
PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK="$SNAPSHOT/transaction.lock"
PROVISION_STAGE_FREQUENCY_SNAPSHOT="$SNAPSHOT"
PROVISION_STAGE_FREQUENCY_MUTATION_MARKER="$SNAPSHOT/mutation-started"
cleanup() {
  if [[ "$TRANSACTION_FD_OPEN" == 1 ]]; then
    exec 9>&-
    TRANSACTION_FD_OPEN=0
  fi
  if [[ "$PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED" == 1 ]]; then
    for attempt in {1..90}; do
      if ! systemctl is-active --quiet "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service"; then
        result="$(systemctl show --property=Result --value "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service" 2>/dev/null || true)"
        if [[ "$result" == success ]]; then
          if iptables -w 10 -C OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
            :
          else
            rule_status=$?
            if [[ "$rule_status" == 1 ]]; then
              PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=0
              rm -rf -- "$SNAPSHOT"
              return 0
            fi
          fi
        fi
      fi
      sleep 1
    done
    echo "Ingress remains gated; watchdog is still checking the transaction and local health" >&2
    return 1
  fi
  rm -rf -- "$SNAPSHOT"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# Authenticate the manifest first, then verify each root-owned snapshot file.
install -m 600 -- "$PACKAGE/deploy-manifest.json" "$SNAPSHOT/deploy-manifest.json"
ACTUAL_MANIFEST_SHA="$(sha256sum "$SNAPSHOT/deploy-manifest.json")"
[[ "${ACTUAL_MANIFEST_SHA%% *}" == "$MANIFEST_SHA" ]]
EXPECTED_INPUTS="$("$PYTHON" -I -B -c 'import json,sys; print("\n".join(k+" "+v for k,v in sorted(json.load(open(sys.argv[1]))["inputs"].items())))' "$SNAPSHOT/deploy-manifest.json")"
while read -r relative expected_sha; do
  [[ -n "$relative" && "$relative" != */* && "$expected_sha" =~ ^[0-9a-f]{64}$ ]]
  case "$relative" in
    deploy.py|deployment_gate.sh|deployment_watchdog.sh|patch_backend.py|shared-deploy.py|source.patch|verify_successor.py) ;;
    *) echo "Unexpected package input: $relative" >&2; exit 1 ;;
  esac
  install -m 600 -- "$PACKAGE/$relative" "$SNAPSHOT/$relative"
  actual_sha="$(sha256sum "$SNAPSHOT/$relative")"
  [[ "${actual_sha%% *}" == "$expected_sha" ]]
done <<< "$EXPECTED_INPUTS"

# The lock FD is inherited by the Python transaction, so the watchdog cannot
# release ingress while either this launcher or a child installer is alive.
exec 9>"$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK"
TRANSACTION_FD_OPEN=1
flock -n 9
PROVISION_STAGE_FREQUENCY_STAGE="$SNAPSHOT" \
  "$PYTHON" -I -B "$SNAPSHOT/deploy.py" --check "$MANIFEST_SHA"

DEPLOYMENT_PINS="$("$PYTHON" -I -B -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["files"]["worker/workflow.py"]["before"],m["files"]["worker/workflow.py"]["after"],m["mirror"]["worker/workflow.py"])' "$SNAPSHOT/deploy-manifest.json")"
read -r PROVISION_STAGE_FREQUENCY_BEFORE_SHA PROVISION_STAGE_FREQUENCY_AFTER_SHA PROVISION_STAGE_FREQUENCY_MIRROR_SHA <<< "$DEPLOYMENT_PINS"
source "$SNAPSHOT/deployment_gate.sh"
provision_stage_frequency_block_ingress
provision_stage_frequency_drain_requests
PROVISION_STAGE_FREQUENCY_GATE=$$ \
  PROVISION_STAGE_FREQUENCY_STAGE="$SNAPSHOT" \
  PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK="$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK" \
  PROVISION_STAGE_FREQUENCY_MUTATION_MARKER="$PROVISION_STAGE_FREQUENCY_MUTATION_MARKER" \
  "$PYTHON" -I -B "$SNAPSHOT/deploy.py" --deploy "$MANIFEST_SHA"
