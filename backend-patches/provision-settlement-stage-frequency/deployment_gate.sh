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
  local parent_stat parent_rest parent_start
  IFS= read -r parent_stat < "/proc/$$/stat"
  parent_rest="${parent_stat##*) }"
  local -a parent_fields=()
  read -r -a parent_fields <<< "$parent_rest"
  parent_start="${parent_fields[19]:-}"
  if [[ -z "$parent_start" ]]; then
    echo "Cannot identify deployment process for ingress watchdog" >&2
    return 1
  fi
  local monitor='parent_pid=$1; expected_start=$2; shift 2
while :; do
  if [[ ! -r "/proc/$parent_pid/stat" ]]; then break; fi
  IFS= read -r process_stat < "/proc/$parent_pid/stat" || break
  process_rest="${process_stat##*) }"
  read -r -a process_fields <<< "$process_rest"
  if [[ "${process_fields[19]:-}" != "$expected_start" ]]; then break; fi
  sleep 1
done
/usr/sbin/iptables -D OUTPUT "$@" || true'
  systemd-run --quiet --no-block --unit="$PROVISION_STAGE_FREQUENCY_GATE_UNIT" \
    --property=Restart=on-failure --property=RestartSec=1 \
    /bin/bash -c "$monitor" _ "$$" "$parent_start" "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"
  for attempt in {1..10}; do
    if systemctl is-active --quiet "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service"; then
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
  if [[ "$PROVISION_STAGE_FREQUENCY_GATE_ACTIVE" == 1 ]]; then
    if iptables -D OUTPUT "${PROVISION_STAGE_FREQUENCY_GATE_RULE[@]}"; then
      PROVISION_STAGE_FREQUENCY_GATE_ACTIVE=0
      systemctl stop "$PROVISION_STAGE_FREQUENCY_GATE_UNIT.service" >/dev/null 2>&1 || true
    else
      echo "Gate cleanup delegated to the deployment-process watchdog" >&2
      return 1
    fi
  fi
}
