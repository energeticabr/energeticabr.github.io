# Supplier status choices

**Goal:** Show ATIVO and INATIVO directly in the supplier-registration wizard, including the wizard embedded in launch creation. Preserve the existing return-to-parent action.

**Design:** Disable recommended-value confirmation for `status_fornecedor_suprimentos`, retain stable IDs 1 and 2 and exact persisted values, and refresh its selection options like the two existing supplier binary questions. No registration, financial write, HR checkpoint or parent draft is submitted during verification. The shared service supplies the options to Android, iOS and Windows.

## Plan

- [x] Reproduce the real status prompt, inactive selection and old cached-menu behavior using synthetic resumed drafts.
- [x] Apply the scoped configuration change and refresh stale options without changing other selections.
- [x] Validate both values, stale controls, resume and preserved parent context; validate JSON deployment artifacts and rollback.
- [x] Review and publish with drift pins and backup. Open the authenticated app and verify connectivity without selecting a status or submitting a registration. The live session was at the Supplies menu; the exact status choices were verified by the real workflow fixture.
