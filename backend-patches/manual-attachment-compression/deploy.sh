#!/usr/bin/env bash
set -euo pipefail
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$PACKAGE" == /home/opc/manual-compression-qa-20261022/release ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]
# The check verifies all package hashes before the existing gate is sourced.
"$PYTHON" "$PACKAGE/deploy.py" --check "$1"
source "$PACKAGE/deployment_gate.sh"
trap diary_release_ingress EXIT
trap 'exit 1' HUP INT TERM
diary_block_ingress
diary_drain_requests
MANUAL_COMPRESSION_GATE=$$ "$PYTHON" "$PACKAGE/deploy.py" --deploy "$1"
