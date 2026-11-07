#!/usr/bin/env bash
set -euo pipefail
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$(stat -c '%u:%a' "$PACKAGE")" == '0:700' && "$(id -u)" == 0 && "$#" == 1 ]]
exec 9</tmp/energetica-whatsapp-deploy.lock
flock -xn 9
"$PYTHON" -B "$PACKAGE/deploy.py" --check "$1"
VERIFIED_GATE="$(< "$PACKAGE/deployment_gate.sh")"
VERIFIED_GATE_SHA="$(printf '%s\n' "$VERIFIED_GATE" | sha256sum)"
[[ "${VERIFIED_GATE_SHA%% *}" == ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6 ]]
source /dev/stdin <<< "$VERIFIED_GATE"
trap diary_release_ingress EXIT
trap 'exit 1' HUP INT TERM
diary_block_ingress
diary_drain_requests
"$PYTHON" -B "$PACKAGE/deploy.py" --deploy "$1"
