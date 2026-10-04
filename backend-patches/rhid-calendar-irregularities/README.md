# RHID calendar irregular-presence snapshot

The app adds a red `N irreg.` label beneath calendar dates. It counts each person/day once using the existing report's effective four slots, after SharePoint administrator adjustments. No punches at all means absence, not an incomplete presence. The warning describes incompleteness at consultation time, including current day and weekends; it does not judge worked-hour duration. Full wording is included in the accessible day label.

`channel_bridge.patch` extends the existing authorized `rhid_attendance_month` response with slim `rows`. `rhid_calendar_snapshot.py` makes one paginated monthly read of `RHID AJUSTES DE PONTO`, uses the newest valid item ID per date/person/slot, and omits actor/justification metadata. RHID source and audit records are never written.

Deployment uses `deploy.sh` with verified live and patched bridge SHAs, no-overwrite backup, syntax/contract tests, health check and automatic rollback. Stage the exact full patched bridge as `channel_bridge.next.py`; the patch is the auditable record (the VM has no patch/git utility). Before a later deployment, download and inspect the current source; do not reuse the recorded SHAs blindly. The older monthly response remains readable by the app without invented warning counts.

Tests: set `RHID_BRIDGE_SOURCE` to current patched `channel_bridge.py`, then `python -m unittest discover -s backend-patches/rhid-calendar-irregularities`. The live `smoke.py` runs under the service environment and prints only row counts.
