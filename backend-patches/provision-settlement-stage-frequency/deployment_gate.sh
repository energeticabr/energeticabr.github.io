#!/usr/bin/env bash
set -euo pipefail

PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=0
PROVISION_STAGE_FREQUENCY_GATE_UNIT="provision-stage-frequency-release-$$"
PROVISION_STAGE_FREQUENCY_GATE_RULE=(-o lo -d 127.0.0.1 -p tcp --dport 8765 --syn
  -m owner '!' --uid-owner 0 -m comment --comment "provision-stage-frequency-$$"
  -j REJECT --reject-with tcp-reset)

provision_stage_frequency_block_ingress() {
  if [[ "$(id -u caddy)" == 0 ]]; then
    echo "Cannot gate a root-owned proxy" >&2
    return 1
  fi
  if [[ ! -f "$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK" ]]; then
    echo "Transaction lock is missing; refusing to gate ingress" >&2
    return 1
  fi
  systemd-run --quiet --no-block --unit="$PROVISION_STAGE_FREQUENCY_GATE_UNIT" \
    --property=Restart=on-failure --property=RestartSec=1 \
    /bin/bash "$PROVISION_STAGE_FREQUENCY_SNAPSHOT/deployment_watchdog.sh" \
    "$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK" \
    "$PROVISION_STAGE_FREQUENCY_SNAPSHOT" \
    "$PROVISION_STAGE_FREQUENCY_BEFORE_SHA" "$PROVISION_STAGE_FREQUENCY_AFTER_SHA" \
    "$PROVISION_STAGE_FREQUENCY_MIRROR_SHA" \
    "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}" 9>&-
  PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=1
  for attempt in {1..10}; do
    if systemctl is-active --quiet "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service"; then
      if ! iptables -w 10 -I OUTPUT 1 "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
        return 1
      fi
      return 0
    fi
    sleep 1
  done
  echo "Ingress watchdog did not start" >&2
  return 1
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
