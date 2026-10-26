# Provision settlement: single initial review

**Goal:** Keep SUBMETER usable after uploading attachments to the grouped provision overview, without requiring a second initial review.

**Design:** The shared backend stages overview attachments like other form attachments. It retains the overview's active question and actions. An explicit overview submit/edit action repairs old drafts left in attachment collection, then uses the existing validated selection handler. Finishing attachment collection alone never approves the overview. Payment questions and final financial confirmation remain required.

**Scope:** Only `worker/provision_description_settlement.py`, distributed as a private-source patch. No user record/state migration, financial write, credentials, native code, or protected signature gesture changes. Shared server behavior applies to Android, iOS and Windows clients.

## Implementation plan

- [x] Reproduce with the real conversation engine and three synthetic files; observe failing tests before implementation.
- [x] Preserve overview stage/options during uploads; recover explicit actions in legacy collection states.
- [x] Verify overview editing, attachment finalization, final confirmation, duplicate events and legacy recovery, using isolated attachment-control storage.
- [x] Package with exact source hashes, run installer tests, and obtain a fresh reviewer assessment.
- [ ] Merge the reviewed patch and deploy the shared backend with backup, health checks and hash verification.
- [ ] Open the authenticated app without submitting a real financial draft; record release evidence.

## Review focus

- Attachment completion without SUBMETER must not approve financial data.
- Stale submit/edit buttons must only recover the grouped overview.
- Existing frozen journals and completed settlements must remain immutable.
- Duplicate messages must not advance twice.
- All supplied files remain staged through the final confirmation.
