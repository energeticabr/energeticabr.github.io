#!/usr/bin/env bash
set -euo pipefail
package=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
python=/opt/energetica-whatsapp/.venv/bin/python
gate=/var/lib/energetica-deploy/launch-order-cleanup-20261111/deployment_gate.sh
expected_gate=ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6
[[ "$(id -u)" == 0 && "$#" == 0 ]]
lock=/tmp/energetica-whatsapp-deploy.lock
[[ -f "$lock" && ! -L "$lock" ]]
exec 9<>"$lock"
flock -n 9
"$python" -B "$package/deploy.py"
gate_source=$(< "$gate")
gate_sha=$(printf '%s\n' "$gate_source" | sha256sum)
[[ "${gate_sha%% *}" == "$expected_gate" ]]
source /dev/stdin <<< "$gate_source"
trap diary_release_ingress EXIT
trap 'exit 1' HUP INT TERM
diary_block_ingress
diary_drain_requests
ENERGETICA_SETTLEMENT_PROPERTY_GATED=1 "$python" -B "$package/deploy.py" --apply
