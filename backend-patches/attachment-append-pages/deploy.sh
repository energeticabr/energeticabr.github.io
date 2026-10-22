#!/usr/bin/env bash
set -euo pipefail
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/attachment-append-pages-20261022/release ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]
# Validate reviewed package hashes before executing the staged gate.
"$PYTHON" -B "$PACKAGE/deploy.py" --check "$1"
# Capture once, verify that exact text, and execute only the verified capture.
# Do not reopen a staged script between verification and root execution.
VERIFIED_GATE="$(< "$PACKAGE/deployment_gate.sh")"
VERIFIED_GATE_SHA="$(printf '%s\n' "$VERIFIED_GATE" | sha256sum)"
[[ "${VERIFIED_GATE_SHA%% *}" == ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6 ]]
source /dev/stdin <<< "$VERIFIED_GATE"
trap diary_release_ingress EXIT
trap 'exit 1' HUP INT TERM
diary_block_ingress
diary_drain_requests
APPEND_PAGES_GATE=$$ "$PYTHON" -B "$PACKAGE/deploy.py" --deploy "$1"
