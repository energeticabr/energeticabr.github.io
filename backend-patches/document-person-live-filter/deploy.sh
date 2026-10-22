#!/usr/bin/env bash
set -euo pipefail
# Parent executes reviewed, captured shell bytes through trusted inline Python.
# The fallback is lazy: captured stdin with a verified package never evaluates
# BASH_SOURCE, which is absent when the parent invokes bash -s.
PACKAGE="${DOCUMENT_PERSON_VERIFIED_PACKAGE:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
PYTHON=/opt/energetica-whatsapp/.venv/bin/python
DEPLOY_PY_SHA=50996a3aa9ed238ce96bb5b3664dc7e390aa7386071be94b87749949a5790abd
[[ "$PACKAGE" == /home/opc/document-related-person-live-filter-20261022/release ]]
[[ "$(cd -- "$PACKAGE" && pwd -P)" == "$PACKAGE" ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]
# Capture installer bytes exactly once; only trusted bootstrap code runs first.
VERIFIED_DEPLOY_B64="$("$PYTHON" -B - "$PACKAGE/deploy.py" "$DEPLOY_PY_SHA" <<'PY'
import base64
import hashlib
from pathlib import Path
import sys

path = Path(sys.argv[1])
if (path.is_symlink() or path.resolve() != path.absolute()
        or not path.is_file() or path.stat().st_nlink != 1):
    raise SystemExit('Unexpected installer alias')
data = path.read_bytes()
if hashlib.sha256(data).hexdigest() != sys.argv[2]:
    raise SystemExit('Installer hash mismatch before execution')
print(base64.b64encode(data).decode('ascii'))
PY
)"
readonly VERIFIED_DEPLOY_B64 DEPLOY_PY_SHA
run_installer() {
  "$PYTHON" -B -c '
import base64
import hashlib
import sys

path, expected, encoded, *arguments = sys.argv[1:]
data = base64.b64decode(encoded, validate=True)
if hashlib.sha256(data).hexdigest() != expected:
    raise SystemExit("Captured installer hash mismatch")
sys.argv = [path, *arguments]
exec(compile(data, path, "exec"), {"__name__": "__main__", "__file__": path})
' "$PACKAGE/deploy.py" "$DEPLOY_PY_SHA" "$VERIFIED_DEPLOY_B64" "$@"
}
# Both modes execute the same verified capture, never the staged file again.
run_installer --check "$1"
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
DOCUMENT_PERSON_FILTER_GATE=$$ run_installer --deploy "$1"
