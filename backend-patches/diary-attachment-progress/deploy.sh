#!/usr/bin/env bash
set -euo pipefail

# Run as root only after review and tests. Sources/registry are already staged.
ROOT=/opt/energetica-whatsapp
PACKAGE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$ROOT/.venv/bin/python"
FILES=(channel_bridge.py worker/diary_evidence.py worker/workflow.py)
if [[ "$PACKAGE" != /tmp/diary-progress-tools-20261021 ]]; then
  echo "Unexpected package directory" >&2
  exit 1
fi
(cd "$ROOT" && sha256sum --check "$PACKAGE/base.sha256")
STAGING="$(mktemp -d /opt/energetica-whatsapp/diary-progress-stage.XXXXXXXX)"
"$PYTHON" "$PACKAGE/patch_backend.py" "$ROOT" "$STAGING"
"$PYTHON" -m py_compile "$STAGING/channel_bridge.py" "$STAGING/worker/diary_evidence.py" "$STAGING/worker/workflow.py" "$STAGING/diary_progress.py"
DIARY_PROGRESS_BASE="$ROOT" "$PYTHON" -m unittest discover -s "$PACKAGE" -p test_diary_progress.py
mkdir -p "$STAGING/tests"
cp -- "$PACKAGE/test_diary_evidence.py" "$STAGING/tests/test_diary_evidence.py"
(cd "$STAGING" && PYTHONPATH="$STAGING/worker:$STAGING" "$PYTHON" -m unittest discover -s tests -p test_diary_evidence.py)
# Abort if any other deployment changed the running files during verification.
(cd "$ROOT" && sha256sum --check "$PACKAGE/base.sha256")
if ss -Hnt state established '( sport = :8765 )' | grep -q .; then
  echo "Bridge has an active request; retry this verified deployment when idle" >&2
  exit 1
fi
BACKUP="$(mktemp -d /opt/energetica-whatsapp/diary-progress-backup.XXXXXXXX)"
mkdir -p "$BACKUP/worker"
for file in "${FILES[@]}"; do
  cp --preserve=all -- "$ROOT/$file" "$BACKUP/$file"
done
rollback() {
  trap - ERR
  for file in "${FILES[@]}"; do
    cp --preserve=all -- "$BACKUP/$file" "$ROOT/$file"
  done
  systemctl restart energetica-channel-bridge
  echo "Rolled back; backup retained at $BACKUP" >&2
}
trap rollback ERR
install -m 0644 "$STAGING/diary_progress.py" "$ROOT/diary_progress.py"
chown --reference="$ROOT/channel_bridge.py" "$ROOT/diary_progress.py"
for file in "${FILES[@]}"; do
  install -m 0644 "$STAGING/$file" "$ROOT/$file"
  chown --reference="$BACKUP/$file" "$ROOT/$file"
done
systemctl restart energetica-channel-bridge
for attempt in {1..15}; do
  if curl --silent --fail http://127.0.0.1:8765/health >/dev/null; then
    systemctl is-active --quiet energetica-channel-bridge
    trap - ERR
    echo "Healthy; backup retained at $BACKUP; staging retained at $STAGING"
    exit 0
  fi
  sleep 1
done
false
