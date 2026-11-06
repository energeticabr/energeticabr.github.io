#!/usr/bin/env bash
set -euo pipefail
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/submission-menu-20261106/release-v4 ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]
# Validate reviewed package hashes before executing the staged gate.
"$PYTHON" -B "$PACKAGE/deploy.py" --check "$1"
# Capture once, verify that exact text, and execute only the verified capture.
# Do not reopen a staged script between verification and root execution.
VERIFIED_GATE="$(< "$PACKAGE/deployment_gate.sh")"
VERIFIED_GATE_SHA="$(printf '%s\n' "$VERIFIED_GATE" | sha256sum)"
[[ "${VERIFIED_GATE_SHA%% *}" == 4772b66c2bd678252651f1c7fa5234e56e52e100dc01866c83135520c5b1e298 ]]
source /dev/stdin <<< "$VERIFIED_GATE"
trap diary_release_ingress EXIT
trap 'exit 1' HUP INT TERM
diary_block_ingress
diary_drain_requests
SUBMISSION_COMPLETED_MENU_GATE=$$ "$PYTHON" -B "$PACKAGE/deploy.py" --deploy "$1"
