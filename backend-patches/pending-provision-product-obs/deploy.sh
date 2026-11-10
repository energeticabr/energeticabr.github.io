#!/usr/bin/env bash
set -euo pipefail
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
[[ "$#" == 1 && "$(id -u)" == 0 ]]
# The release is copied and hash-checked by root before this script runs.
# Refuse execution from the user-writable upload staging directory.
[[ "$PACKAGE" == /var/lib/energetica-deploy/pending-provision-product-obs-20261110 ]]
for directory in /var /var/lib /var/lib/energetica-deploy "$PACKAGE"; do
  [[ "$(stat -c %u "$directory")" == 0 ]]
  [[ -z "$(find "$directory" -maxdepth 0 -perm /022 -print)" ]]
done
[[ -z "$(find "$PACKAGE" -maxdepth 1 -type f \( ! -user root -o -perm /022 \) -print)" ]]
"$PYTHON" -B "$PACKAGE/deploy.py" --check "$1"
VERIFIED_GATE="$(< "$PACKAGE/deployment_gate.sh")"
VERIFIED_GATE_SHA="$(printf '%s\n' "$VERIFIED_GATE" | sha256sum)"
[[ "${VERIFIED_GATE_SHA%% *}" == ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6 ]]
source /dev/stdin <<< "$VERIFIED_GATE"
trap diary_release_ingress EXIT
trap 'exit 1' HUP INT TERM
diary_block_ingress
diary_drain_requests
PROVISION_DUE_VALUE_GATE=$$ "$PYTHON" -B "$PACKAGE/deploy.py" --deploy "$1"
