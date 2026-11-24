#!/usr/bin/env bash
set -uo pipefail

lock_path=$1
snapshot=$2
before_sha=$3
after_sha=$4
mirror_sha=$5
shift 5

# The transaction lock is inherited by the installer and its restart command.
while ! /usr/bin/flock --nonblock "$lock_path" -c /usr/bin/true >/dev/null 2>&1; do
  sleep 1
done

# Fail closed until a complete baseline or candidate is healthy locally.
while :; do
  if ! connections="$(ss -Hnt state established '( sport = :8765 )' 2>/dev/null)" \
      || [[ -n "$connections" ]]; then
    sleep 1
    continue
  fi
  live_sum=$(/usr/bin/sha256sum /opt/energetica-whatsapp/worker/workflow.py 2>/dev/null)
  mirror_sum=$(/usr/bin/sha256sum /home/opc/energetica-build/worker/workflow.py 2>/dev/null)
  live_sha=${live_sum%% *}
  mirror_actual=${mirror_sum%% *}

  if [[ "$live_sha" == "$before_sha" || "$live_sha" == "$after_sha" ]] \
      && [[ "$mirror_actual" == "$mirror_sha" ]] \
      && /usr/bin/systemctl is-active --quiet energetica-channel-bridge.service \
      && /usr/bin/systemctl is-active --quiet energetica-whatsmeow.service \
      && /usr/bin/curl -fsS --max-time 5 http://127.0.0.1:8765/health \
        | /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
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
  fi
  sleep 1
done
