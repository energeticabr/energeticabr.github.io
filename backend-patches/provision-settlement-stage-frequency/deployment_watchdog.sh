#!/usr/bin/env bash
set -uo pipefail

transaction_lock=$1
snapshot=$2
mutation_marker=$3
shared_lock=$4
mirror_sha=$5
shift 5
opc_uid=$(/usr/bin/id -u opc)

# Wait for the launcher, Python installer, and any systemctl restart child.
while ! /usr/bin/flock --nonblock "$transaction_lock" -c /usr/bin/true >/dev/null 2>&1; do
  sleep 1
done

# Serialize the final health check and gate removal with every shared deploy.
while :; do
  if [[ ! -f "$shared_lock" || -L "$shared_lock" ]]; then
    sleep 1
    continue
  fi
  read -r lock_dev lock_ino lock_uid lock_links < <(/usr/bin/stat -c '%d %i %u %h' "$shared_lock" 2>/dev/null)
  if [[ -z "${lock_dev:-}" || "$lock_links" != 1 || ( "$lock_uid" != 0 && "$lock_uid" != "$opc_uid" ) ]]; then
    sleep 1
    continue
  fi
  if ! exec 8<> "$shared_lock"; then
    sleep 1
    continue
  fi
  fd_identity=$(/usr/bin/stat -Lc '%d %i %u %h' "/proc/$$/fd/8" 2>/dev/null)
  path_identity=$(/usr/bin/stat -c '%d %i %u %h' "$shared_lock" 2>/dev/null)
  expected_identity="$lock_dev $lock_ino $lock_uid $lock_links"
  if [[ "$fd_identity" != "$expected_identity" || "$path_identity" != "$expected_identity" ]] \
      || ! /usr/bin/flock --nonblock 8; then
    exec 8>&-
    sleep 1
    continue
  fi

  # A pre-write abort can reopen ingress with existing sessions still alive.
  # Once the first atomic source write started, wait for the drained sessions.
  if [[ -e "$mutation_marker" ]]; then
    if ! connections="$(ss -Hnt state established '( sport = :8765 )' 2>/dev/null)" \
        || [[ -n "$connections" ]]; then
      exec 8>&-
      sleep 1
      continue
    fi
  fi

  source_pins="$(/opt/energetica-whatsapp/.venv/bin/python -I -B -c 'import hashlib,pathlib,sys; live=pathlib.Path(sys.argv[1]); mirror=pathlib.Path(sys.argv[2]); assert not live.is_symlink() and not mirror.is_symlink(); source=live.read_bytes(); compile(source,str(live),"exec"); print(hashlib.sha256(source).hexdigest(),hashlib.sha256(mirror.read_bytes()).hexdigest())' \
    /opt/energetica-whatsapp/worker/workflow.py /home/opc/energetica-build/worker/workflow.py 2>/dev/null)"
  read -r live_sha mirror_actual <<< "$source_pins"
  if [[ ! "$live_sha" =~ ^[0-9a-f]{64}$ || "$mirror_actual" != "$mirror_sha" ]] \
      || ! /usr/bin/systemctl is-active --quiet energetica-channel-bridge.service \
      || ! /usr/bin/systemctl is-active --quiet energetica-whatsmeow.service \
      || ! /usr/bin/curl -fsS --max-time 5 http://127.0.0.1:8765/health \
        | /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    exec 8>&-
    sleep 1
    continue
  fi

  # Keep the shared lock through the successful removal so another deploy
  # cannot change the file between its final validation and ingress recovery.
  if /usr/sbin/iptables -w 10 -D OUTPUT "$@"; then
    /usr/bin/rm -rf -- "$snapshot"
    exit 0
  fi
  if /usr/sbin/iptables -w 10 -C OUTPUT "$@"; then
    sleep 1
    continue
  else
    rule_status=$?
    if [[ "$rule_status" == 1 ]]; then
      /usr/bin/rm -rf -- "$snapshot"
      exit 0
    fi
  fi
  sleep 1
done
