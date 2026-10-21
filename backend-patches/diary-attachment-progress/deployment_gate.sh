#!/usr/bin/env bash
# Exclude new proxy/worker connections, drain accepted requests, allow root
# health probes, and bound maintenance even if the deployment shell is killed.
DIARY_GATE_ACTIVE=0
DIARY_GATE_UNIT="energetica-diary-progress-release-$$"
DIARY_GATE_RULE=(-o lo -d 127.0.0.1 -p tcp --dport 8765 --syn
  -m owner '!' --uid-owner 0 -m comment --comment "diary-progress-$$"
  -j REJECT --reject-with tcp-reset)

diary_block_ingress() {
  if [[ "$(id -u caddy)" == 0 ]]; then
    echo "Cannot gate a root-owned proxy" >&2
    return 1
  fi
  iptables -I OUTPUT 1 "${DIARY_GATE_RULE[@]}"
  DIARY_GATE_ACTIVE=1
  systemd-run --quiet --unit="$DIARY_GATE_UNIT" --on-active=120s +    /usr/sbin/iptables -D OUTPUT "${DIARY_GATE_RULE[@]}"
}

diary_drain_requests() {
  local connections
  for attempt in {1..30}; do
    connections="$(ss -Hnt state established '( sport = :8765 )')" || return 1
    if [[ -z "$connections" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Active bridge requests did not drain; deployment cancelled" >&2
  return 1
}

diary_release_ingress() {
  if [[ "$DIARY_GATE_ACTIVE" == 1 ]]; then
    if iptables -D OUTPUT "${DIARY_GATE_RULE[@]}"; then
      DIARY_GATE_ACTIVE=0
      systemctl stop "$DIARY_GATE_UNIT.timer" >/dev/null 2>&1 || true
    else
      echo "Gate cleanup delegated to the 120-second watchdog" >&2
      return 1
    fi
  fi
}
