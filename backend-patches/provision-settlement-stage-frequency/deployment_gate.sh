#!/usr/bin/env bash
set -euo pipefail

PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=0
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
  local monitor='lock_path=$1; snapshot=$2; shift 2
while ! /usr/bin/flock --nonblock "$lock_path" -c /usr/bin/true >/dev/null 2>&1; do sleep 1; done
while :; do
  if /usr/sbin/iptables -w 10 -D OUTPUT "$@"; then break; fi
  if /usr/sbin/iptables -w 10 -C OUTPUT "$@"; then
    sleep 1
  else
    status=$?
    if [[ "$status" == 1 ]]; then break; fi
    sleep 1
  fi
done
/usr/bin/rm -rf -- "$snapshot"'
  systemd-run --quiet --no-block --unit="$PROVISION_STAGE_FREQUENCY_GATE_UNIT" \
    --property=Restart=on-failure --property=RestartSec=1 \
    /bin/bash -c "$monitor" _ "$PROVISION_STAGE_FREQUENCY_TRANSACTION_LOCK" \
    "$PROVISION_STAGE_FREQUENCY_SNAPSHOT" "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}" 9>&-
  PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=1
  for attempt in {1..10}; do
    if systemctl is-active --quiet "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service"; then
      if ! iptables -w 10 -I OUTPUT 1 "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
        if iptables -w 10 -C OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
          PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=1
        fi
        return 1
      fi
      PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=1
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

provision_stage_frequency_release_ingress() {
  if [[ "$PROVISION_STAGE_FREQUENCY_GATE_ACTIVE" == 0 && "$PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED" == 1 ]]; then
    if iptables -w 10 -C OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
      PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=1
    else
      local initial_check_status=$?
      if [[ "$initial_check_status" != 1 ]]; then
        echo "Gate state could not be checked; watchdog will retry" >&2
        return 1
      fi
    fi
  fi
  if [[ "$PROVISION_STAGE_FREQUENCY_GATE_ACTIVE" == 1 ]]; then
    if ! iptables -w 10 -D OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
      if iptables -w 10 -C OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
        echo "Gate cleanup delegated to the transaction-lock watchdog" >&2
        return 1
      else
        local check_status=$?
        if [[ "$check_status" != 1 ]]; then
          echo "Gate state could not be checked; watchdog will retry" >&2
          return 1
        fi
      fi
    fi
    PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=0
  fi
  if [[ "$PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED" == 1 ]]; then
    if systemctl stop "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service" >/dev/null 2>&1; then
      PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=0
    elif ! systemctl is-active --quiet "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service"; then
      PROVISION_STAGE_FREQUENCY_WATCHDOG_ARMED=0
    else
      echo "Ingress watchdog remains active and owns cleanup" >&2
      return 1
    fi
  fi
}
