#!/usr/bin/env bash
set -euo pipefail

PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/provision-settlement-stage-frequency-20261124-r2/release ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]
[[ "$1" =~ ^[0-9a-f]{64}$ ]]

umask 077
SNAPSHOT="$(mktemp -d /run/provision-stage-frequency.XXXXXXXX)"
chmod 700 "$SNAPSHOT"
cleanup() {
  if declare -F provision_stage_frequency_release_ingress >/dev/null; then
    provision_stage_frequency_release_ingress || true
  fi
  rm -rf -- "$SNAPSHOT"
}
trap cleanup EXIT

# The supplied digest authenticates a root-owned snapshot before any staged
# Python is executed. Every executed input is verified from the same snapshot.
install -m 600 -- "$PACKAGE/deploy-manifest.json" "$SNAPSHOT/deploy-manifest.json"
ACTUAL_MANIFEST_SHA="$(sha256sum "$SNAPSHOT/deploy-manifest.json")"
[[ "${ACTUAL_MANIFEST_SHA%% *}" == "$1" ]]
EXPECTED_INPUTS="$("$PYTHON" -B -c 'import json,sys; print("\n".join(k+" "+v for k,v in sorted(json.load(open(sys.argv[1]))["inputs"].items())))' "$SNAPSHOT/deploy-manifest.json")"
while read -r relative expected_sha; do
  [[ -n "$relative" && "$relative" != */* && "$expected_sha" =~ ^[0-9a-f]{64}$ ]]
  install -m 600 -- "$PACKAGE/$relative" "$SNAPSHOT/$relative"
  actual_sha="$(sha256sum "$SNAPSHOT/$relative")"
  [[ "${actual_sha%% *}" == "$expected_sha" ]]
done <<< "$EXPECTED_INPUTS"

PROVISION_STAGE_FREQUENCY_STAGE="$SNAPSHOT" \
  "$PYTHON" -B "$SNAPSHOT/deploy.py" --check "$1"
EXPECTED_GATE_SHA="$("$PYTHON" -B -c 'import json,sys; print(json.load(open(sys.argv[1]))["inputs"]["deployment_gate.sh"])' "$SNAPSHOT/deploy-manifest.json")"
VERIFIED_GATE="$(< "$SNAPSHOT/deployment_gate.sh")"
VERIFIED_GATE_SHA="$(printf '%s\n' "$VERIFIED_GATE" | sha256sum)"
[[ "${VERIFIED_GATE_SHA%% *}" == "$EXPECTED_GATE_SHA" ]]
source /dev/stdin <<< "$VERIFIED_GATE"
trap 'exit 1' HUP INT TERM
provision_stage_frequency_block_ingress
provision_stage_frequency_drain_requests
PROVISION_STAGE_FREQUENCY_GATE=$$ PROVISION_STAGE_FREQUENCY_STAGE="$SNAPSHOT" \
  "$PYTHON" -B "$SNAPSHOT/deploy.py" --deploy "$1"
