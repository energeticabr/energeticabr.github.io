#!/usr/bin/env bash
set -euo pipefail
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ "$PACKAGE" == /home/opc/provision-partial-settlement-20261030/release ]]
[[ "$(id -u)" == 0 ]]
[[ "$#" == 1 ]]
exec /opt/energetica-whatsapp/.venv/bin/python -B "$PACKAGE/deploy.py" --deploy "$1"
