# Verification ledger

## Focused checks

- RED observed on old code: four launches created four orders; per-line launch question; uncertain order/child responses; common-stage and consent edits.
- Independent review reproduced attachment editing dropping a child, NO-to-YES missing ETAPA, legacy common-edit consent, and stale expense classification. Added failing regressions before corrections.
- Final source conversation/regression tests: **23 passed** on the VM with synthetic connectors, including the complete attachment-edit path.
- Public package tests on Windows Python3.12: **32 passed** (23 workflow +9 isolated installer checks). Fixture reads use explicit UTF-8.
- Private operator checks: **7 passed**, using captured private inputs and an in-memory REST boundary. No financial writes during tests or preview. These private records are not part of this repository.
- Signature guard: **14 protected blocks unchanged**. `git diff --check` clean.
- Independent follow-up review: no remaining Critical/Important findings. Exact source scope is two Python files; no changes to mobile signature code or native client contract.

## Historical suite limitations

The copied historical backend suite is not green on the fresh production baseline, before this patch. Windows baseline: **2,210 tests;1,259 failures;119 errors;3 skips**. Examples include `test_legacy_child_selection_remains_legacy`, `test_invalid_group_is_visible_but_not_selectable_or_prepared`, `test_all_selection_fields_offer_blank_and_blank_is_not_persisted`, and `test_other_suppliers_query_uses_real_columns_same_day_and_preserves_source`. The historical grouped-workflow snapshot alone already had11 failures on baseline, including obsolete invalid-amount expectations and hard-coded selection IDs.

The full baseline/candidate runs on the1GB production VM were interrupted because they caused swap pressure; both service health checks remained healthy, test processes were stopped, and memory recovered. Those interrupted runs are not pass evidence. The broader comparison was moved to an isolated Windows dependency folder, without changing the production Python environment. Full failure names and baseline/candidate logs remain in the private task evidence folder; do not label the historical suite all-green.

## Deployment and data repair

The source installer `--check` confirmed the reviewed source hashes and healthy services. Deployment/recovery receipts and the separately authorized historical-data repair are private operational evidence, not public source artifacts. Confirm their actual results before reporting publication or record correction as complete.
