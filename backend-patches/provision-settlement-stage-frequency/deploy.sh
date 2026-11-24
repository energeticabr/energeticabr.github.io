#!/usr/bin/env bash
set -euo pipefail

PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/provision-settlement-stage-frequency-20261124-r1/release ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]

"$PYTHON" -B "$PACKAGE/deploy.py" --check "$1"
EXPECTED_GATE_SHA="$("$PYTHON" -B -c 'import json,sys; print(json.load(open(sys.argv[1]))["inputs"]["deployment_gate.sh"])' "$PACKAGE/deploy-manifest.json")"
ACTUAL_GATE_SHA="$(sha256sum "$PACKAGE/deployment_gate.sh")"
[[ "${ACTUAL_GATE_SHA%% *}" == "$EXPECTED_GATE_SHA" ]]
VERIFIED_GATE="$(< "$PACKAGE/deployment_gate.sh")"
VERIFIED_GATE_SHA="$(printf '%s\n' "$VERIFIED_GATE" | sha256sum)"
[[ "${VERIFIED_GATE_SHA%% *}" == "$EXPECTED_GATE_SHA" ]]
source /dev/stdin <<< "$VERIFIED_GATE"
trap provision_stage_frequency_release_ingress EXIT
trap 'exit 1' HUP INT TERM
provision_stage_frequency_block_ingress
provision_stage_frequency_drain_requests
PROVISION_STAGE_FREQUENCY_GATE=$$ "$PYTHON" -B "$PACKAGE/deploy.py" --deploy "$1"
