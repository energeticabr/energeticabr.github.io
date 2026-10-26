# SWILE Weekly RH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the next fourteen days of Wednesday SWILE provisions populated by RH supplier, excluding the configured exception, and retire recurrence36 without touching paid records.

**Architecture:** A pure Python planner and reconciliation policy define the financial contract; a standard SharePoint Power Automate definition applies that contract in the existing benefit flow. A narrow authenticated adapter performs the one-time legacy cleanup with backups and version checks. Existing shared lists serve every client.

**Tech Stack:** Python/unittest, standard Power Automate SharePoint connector/WDL, existing SharePoint REST certificate integration.

**Spec:** docs/superpowers/specs/2026-10-26-swile-weekly-rh-design.md

## Global Constraints

- R$225 per supplier every Wednesday: QTD5, unit45, freight0; parent supplier SWILE.
- Complete FUNCIONARIOSRH traversal; exception by configured origin identity; no role-based supplier eligibility.
- Inclusive fourteen-day horizon,06:00 Brasilia, one run at a time, deterministic unique keys.
- Never create paid records, launches, orders or payroll rows; preserve paid/manual/scheduled weeks.
- Clean only exact recurrence36 unpaid records and their exclusively owned empty groups, with backup and ETag checks.
- No employee names, personal documents, credentials or actual excluded IDs in public fixtures/configuration.

## Review Focus

- Wednesday itself, month/year transitions, duplicate names/origin identities and missing links must not silently misroute a provision.
- New RH registrations and a retry after a lost create response must not duplicate or mis-total an open week.
- Existing paid/scheduled/manual records and concurrent payment/version changes must remain untouched.
- Cleanup must distinguish36 from136, pending from paid, and exclusive groups from shared parents.
- An offline package is not a deployed flow; verify actual run receipts, shared-list rows, daily trigger and enabled state.

### Task1: Planner and reconciliation/cleanup policy

**Files:** automations/swile-weekly-rh/model.py, reconcile.py, test_model.py, test_reconcile.py.

**Interfaces:** plan_horizon(rh_rows, reference_date, excluded_supplier_ids) returns dated parent/child intents; reconcile(adapter, plans) returns confirmed IDs; legacy_targets(rows, parents, recurrence_id) returns narrowly scoped candidates. Adapter supplies complete reads, unique create, CAS patch/delete and authoritative verification.

- [x] Write literal-fixture tests for26Oct2026 ->28Oct/04Nov, Wednesday inclusive three dates, year rollover, RH identity validation, exact225-per-row and grouping. Observe RED, implement, then GREEN.
- [x] Exercise the real reconciler against a synthetic external store with uniqueness/ETags: first run, repeated run, new recipient, lost response, partial resume, paid/manual preservation and CAS failure. Cover cleanup's paid/shared/unrelated cases. Observe RED/GREEN.

### Task2: Power Automate definition and deployment

**Files:** automations/swile-weekly-rh/build_flow.py, test_build_flow.py, README.md; .github/workflows/swile-weekly-rh.yml.

**Interfaces:** build_definition(private_config) produces standard-connector WDL matching Task1. Existing flow/connection configuration is backed up privately and retained during update.

- [x] Test actual generated payloads, recurrence, pagination/unique-field gates and mutation/readback boundaries; implement and run all automation suites.
- [ ] Obtain one fresh read-only branch review, address substantive findings with RED/GREEN, and verify no secrets/protected app changes.
- [ ] Update the existing flow only after authenticated live readback; run and independently verify two dated groups and all individual links/totals, then rerun with zero duplicates.

### Task3: Retire legacy recurrence and publish

**Files:** automations/swile-weekly-rh/live_adapter.py, test_live_adapter.py; docs/verification/swile-weekly-rh-20261026.md.

**Interfaces:** execute only reviewed cleanup candidates after Task2 production verification, using existing server authentication without exposing credentials.

- [ ] Persist backups, inactivate36 conditionally, delete only verified unpaid candidates and exclusive empty parents, and verify paid/unrelated snapshots remain unchanged.
- [ ] Read back the enabled daily flow and full fourteen-day coverage. Commit/PR/CI/merge the tested automation and record actual cloud/data receipts. Native clients use existing shared sources without an additional binary build.
