# IDFOLHA receipt attachments implementation plan

**Goal:** Attach receipts in the IDFOLHA editor and reject INATIVO without a confirmed item attachment.
**Architecture:** Item-owned attachment adapter on the authentic editor context; staged UI tray; third saveEditor options argument carries uploads. Reuse validation, receipt picker and presenter. Upload then confirm attachment then conditional ETag update; compare user fields before accepting an upload-generated ETag.
**Tech Stack:** JavaScript, SharePoint repository, native DOM, node:test/JSDOM, Vite/Capacitor.
**Spec:** docs/superpowers/specs/2026-10-08-idfolha-receipt-attachments.md

## Global Constraints

- Only IDFOLHA editing gets this functionality. Preserve legacy status and all other editors.
- Existing attachments count; no existing-attachment deletion. Cancellation does not upload.
- Strict attachment query; validate every file and duplicate before mutation.
- Enforce INATIVO at save boundary, including unchanged status. Never change status following failed/unconfirmed upload.
- Keep ETag conflict protection, session guards and retries. Compare editable baseline fields after own uploads before accepting refreshed ETag.
- No QA writes to real records; use fixtures. Preserve 14 signature gesture blocks.
- User explicitly authorizes implementation and publication without confirmation; release only internal Android/TestFlight and web, never store production.

## Review Focus

Inspect lost-upload responses, partial uploads/retries, unchanged INATIVO, alternate STATUS metadata names, session cancellation between awaits, pending tray file replacement, duplicate case-insensitive names, and field changes during attachment upload. Check staged file cancellation and responsive tray fit.

### Task 1: IDFOLHA staged tray and safe persistence

**Files:** src/chat/gallery-record-data.js; new src/chat/payroll-sheet-attachments.js; src/chat/orders-gallery-data.js; src/ui/gallery-record-actions.js; new src/ui/payroll-sheet-attachments.js; src/ui/gallery-record-actions.css; src/ui/hr-payroll-gallery-view.js; src/app-controller.js; tests/idfolha-editor-attachments.test.mjs; tests/idfolha-editor-status.test.mjs; fixture/layout regression.

**Interfaces**

- Produces context.sheetAttachments with list() and read(file); adapter prepare(uploads,{inactive}) returns the ETag eligible for update.
- Consumes repository listAttachments/uploadAttachment/downloadAttachment/getItem, guarded by assertSession.
- saveEditor(context,fields,{attachments: File[]}) forwards through controller and gallery wrapper; unaffected contexts retain existing two-argument behavior.
- Tray binding changes() returns selected files; cleanup() cancels receipt picker and ignores late loads.

1. Add failing tests through actual createHrPayrollGalleryData and editor: reject INATIVO with zero files (including unchanged/alternate name); no update on upload failure/unconfirmed upload; upload before update and fresh ETag; existing receipt counts; retry does not repeat successful upload; concurrent field change rejected; invalid/duplicate files rejected; ATIVO without attachment allowed; cancelled session prevents update; UI tray exists and visible signed-receipt error, file staging/removal/cancel and app-tray selection.
   Run: node --test tests/idfolha-editor-attachments.test.mjs
   Expected: new assertions fail because attachment gate/tray is missing, not import/setup failures.
2. Implement adapter and forwarding. Validate all files before any writes, strict current list read, initial/current ETag comparison, successful-file tracking, post-upload current field comparison and confirmed list before status patch. UI binds only owned IDFOLHA context, shows existing and pending file names with local removal only, uses receipt picker and download presenter, disables during submit and guards stale callbacks.
   Run same command.
   Expected: all new assertions pass; financial update log always follows attachment confirmation.
3. Adapt status fixture to include an already saved receipt for existing INATIVO success expectations. Add synthetic responsive fixture with exact real editor and a saved/pending file; verify narrow mobile/tablet/Windows widths, error and button placement.
   Run: node --test tests/idfolha-editor-attachments.test.mjs tests/idfolha-editor-status.test.mjs tests/gallery-record-actions.test.mjs tests/gallery-record-data.test.mjs tests/hr-payroll-gallery-view.test.mjs
   Expected: all pass, no other editor receives a tray.
4. Run pnpm guard:signature-gestures; pnpm test; pnpm build; pnpm build:pwa; repository secret scan; git diff --check. Portal suite runs separately if needed. Visually inspect fixture via browser, never submit a real IDFOLHA.
   Expected: 14 gesture locks intact, all tests green, both builds succeed, no secrets or whitespace errors.
5. Commit feature, then task-done with the focused command above. Request fresh whole-branch review using plan/spec and ledger. Resolve important findings with failing regressions before patching.
   Commit: feat(payroll): require signed receipt attachment for inactive sheets

## Integration and release

Create PR and attempt attachment to this chat; require all PR checks green. Merge verified HEAD via existing authorized workflow. Confirm main Pages publication, Android internal version committed, and TestFlight build READY_FOR_BETA_TESTING and attached to validation group. Open served web app; do not alter user financial flows for QA. Report both the earlier dropdown release and this change accurately.
