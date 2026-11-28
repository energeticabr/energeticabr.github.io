#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
code=/opt/energetica-whatsapp
state=/var/lib/energetica-whatsapp/financial-report-updates
unit=energetica-financial-report-updates
bridge="$code/channel_bridge.py"
auxiliary="$code/fiscal-collector/src/AuxiliaryFiscal.psm1"
base_hash="${2:-}"
auxiliary_hash="${3:-}"
mode="${1:-}"
if [[ "$mode" != --validate && "$mode" != --apply ]] || [[ ! "$base_hash" =~ ^[0-9a-f]{64}$ || ! "$auxiliary_hash" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Usage: $0 --validate|--apply EXPECTED_CHANNEL_BRIDGE_SHA256 EXPECTED_FISCAL_AUXILIARY_SHA256" >&2
  exit 2
fi
file_hash() { sha256sum "$1" | cut -d' ' -f1; }

exec 9>/run/lock/energetica-financial-report-updates-deploy.lock
flock -n 9
if [[ "$(file_hash "$bridge")" != "$base_hash" || "$(file_hash "$auxiliary")" != "$auxiliary_hash" ]]; then
  echo 'The channel bridge or auxiliary worker changed. Revalidate the current revisions.' >&2
  exit 1
fi
candidate="$(mktemp "$here/channel-bridge.XXXXXXXX")"
auxiliary_candidate="$(mktemp "$here/AuxiliaryFiscal.XXXXXXXX")"
trap 'rm -f -- "$candidate" "$auxiliary_candidate"' EXIT
(cd "$here" && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_report_updates)
python3 "$here/patch_bridge.py" "$bridge" "$candidate"
python3 "$here/patch_bridge.py" --auxiliary "$auxiliary" "$auxiliary_candidate"
FISCAL_CLOCK_CANDIDATE="$auxiliary_candidate" /usr/bin/pwsh -NoProfile -NonInteractive -Command '
  $tokens = $null; $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($env:FISCAL_CLOCK_CANDIDATE, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }
'
systemd-analyze verify "$here/$unit.service" "$here/$unit.timer"
printf 'Validated bridge candidate %s\n' "$(sha256sum "$candidate" | cut -d' ' -f1)"
if [[ "$mode" == --validate ]]; then exit 0; fi

targets=(
  "$code/financial_report_updates.py"
  "$code/collect_financial_report_updates.py"
  "/etc/systemd/system/$unit.service"
  "/etc/systemd/system/$unit.timer"
)
sources=(
  "$here/financial_report_updates.py"
  "$here/collect_updates.py"
  "$here/$unit.service"
  "$here/$unit.timer"
)
backup="$(mktemp -d "$code/backups/financial-report-updates.XXXXXXXX")"
cp -a "$bridge" "$auxiliary" "$backup/"
for target in "${targets[@]}"; do
  if [[ -e "$target" ]]; then cp -a "$target" "$backup/"; fi
done
timer_enabled="$(systemctl is-enabled "$unit.timer" 2>/dev/null || true)"
timer_active="$(systemctl is-active "$unit.timer" 2>/dev/null || true)"
bridge_installed=false
auxiliary_installed=false

replace_file() {
  local source="$1" target="$2" uid="$3" gid="$4" permissions="$5" staged
  staged="$(mktemp "$(dirname "$target")/.financial-report-updates.XXXXXXXX")"
  if ! install -o "$uid" -g "$gid" -m "$permissions" "$source" "$staged"; then
    rm -f -- "$staged"
    return 1
  fi
  mv -fT -- "$staged" "$target"
  restorecon "$target" 2>/dev/null || true
}

rollback() {
  local status="$?"
  trap - ERR
  set +e
  systemctl stop "$unit.timer" "$unit.service"
  if [[ "$timer_enabled" != enabled ]]; then systemctl disable "$unit.timer"; fi
  local target saved
  for target in "${targets[@]}"; do
    saved="$backup/$(basename "$target")"
    if [[ -f "$saved" ]]; then
      cp -a "$saved" "$target"
    else
      rm -f -- "$target"
    fi
  done
  systemctl daemon-reload
  if [[ "$timer_active" == active ]]; then systemctl start "$unit.timer"; fi
  if "$auxiliary_installed" && [[ "$(file_hash "$auxiliary")" == "$(file_hash "$auxiliary_candidate")" ]]; then
    saved="$backup/AuxiliaryFiscal.psm1"
    replace_file "$saved" "$auxiliary" "$(stat -c %u "$saved")" "$(stat -c %g "$saved")" "$(stat -c %a "$saved")"
  fi
  if "$bridge_installed" && [[ "$(file_hash "$bridge")" == "$(file_hash "$candidate")" ]]; then
    saved="$backup/channel_bridge.py"
    replace_file "$saved" "$bridge" "$(stat -c %u "$saved")" "$(stat -c %g "$saved")" "$(stat -c %a "$saved")"
    systemctl restart energetica-channel-bridge.service
  fi
  echo "Deployment rolled back using $backup" >&2
  exit "$status"
}

# Install and verify the data source before switching the HTTP process.
set -E
trap rollback ERR
install -d -o root -g root -m 0755 "$state"
for index in "${!targets[@]}"; do
  replace_file "${sources[$index]}" "${targets[$index]}" root root 0644
done
systemctl daemon-reload
systemctl start "$unit.service"
test -s "$state/latest.json"
runuser -u energetica-whatsapp -- test -r "$state/latest.json"
systemctl enable --now "$unit.timer"

# Recheck the baseline after writing dependencies so a concurrent deploy wins safely.
if [[ "$(file_hash "$bridge")" != "$base_hash" || "$(file_hash "$auxiliary")" != "$auxiliary_hash" ]]; then
  echo 'The channel bridge or auxiliary worker changed during installation.' >&2
  false
fi
replace_file "$auxiliary_candidate" "$auxiliary" "$(stat -c %u "$auxiliary")" \
  "$(stat -c %g "$auxiliary")" "$(stat -c %a "$auxiliary")"
auxiliary_installed=true
replace_file "$candidate" "$bridge" "$(stat -c %u "$backup/channel_bridge.py")" \
  "$(stat -c %g "$backup/channel_bridge.py")" "$(stat -c %a "$backup/channel_bridge.py")"
bridge_installed=true
systemctl restart energetica-channel-bridge.service
curl --silent --show-error --fail --retry 10 --retry-connrefused --max-time 3 http://127.0.0.1:8765/health
systemctl is-active energetica-channel-bridge.service energetica-whatsapp.service "$unit.timer"
trap - ERR
printf '\nInstalled bridge %s\nBackup %s\n' "$(file_hash "$bridge")" "$backup"
