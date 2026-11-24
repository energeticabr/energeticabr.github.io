#!/usr/bin/env bash
set -euo pipefail

PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=0
PROVISION_STAGE_FREQUENCY_GATE_UNIT="provision-stage-frequency-release-$$"
PROVISION_STAGE_FREQUENCY_GATE_RULE=(-o lo -d 127.0.0.1 -p tcp --dport 8765 --syn
  -m owner '!' --uid-owner 0 -m comment --comment "provision-stage-frequency-$$"
  -j REJECT --reject-with tcp-reset)

provision_stage_frequency_block_ingress() {
  if [[ "$(id -u caddy)" == 0 ]]; then
    echo "Cannot gate a root-owned proxy" >&2
    return 1
  fi
  iptables -I OUTPUT 1 "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"
  PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=1
  systemd-run --quiet --unit="$PROVISION_STAGE_FREQUENCY_GATE_UNIT" --on-active=120s /usr/sbin/iptables -D OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"
}

provision_stage_frequency_drain_requests() {
  local connections
  for attempt in {1..30}; do
    connections="$(ss -Hnt state established '( sport = :8765 )')" || return 1
    if [[ -z "$connections" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Active chat requests did not drain; deployment cancelled" >&2
  return 1
}

provision_stage_frequency_release_ingress() {
  if [[ "$PROVISION_STAGE_FREQUENCY_GATE_ACTIVE" == 1 ]]; then
    if iptables -D OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
      PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=0
      systemctl stop "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.timer" >/dev/null 2>&1 || true
    else
      echo "Gate cleanup delegated to the 120-second watchdog" >&2
      return 1
    fi
  fi
}
