# Delete pending provision description implementation plan

> Execute the UI/controller inline; delegate the isolated data service and tests. Use TDD and independent final review.

**Goal:** Red X below green check opens a confirmation naming the parent and all linked provisions. No returns to the unchanged pending list. Yes deletes exactly the confirmed children and then the parent.

**Architecture:** Extend the existing pending popup/controller and authenticated SharePoint repository. A dedicated data service supplies a complete, versioned preview and conditional child-first cascade; the parent survives incomplete deletion. No VM change or actual financial deletion for testing.

**Tech stack:** Existing JavaScript/ES modules, Node tests, JSDOM, SharePoint Graph/REST repository, Vite/Capacitor.

## Global constraints / review focus

- Preserve all 14 protected signature blocks. Guard passed before work.
- Never infer child IDs from the reminder's pending subset: query every linked child, all statuses/pages.
- Confirmation is explicit and tied to the exact versioned set; changing links, versions or child set aborts without deleting unshown records.
- Session/account changes invalidate previews. Double clicks cannot duplicate mutations.
- Partial deletion and lost responses are explicit; retries preserve confirmed scope and never delete the parent while any child remains.
- No unrelated lists/launches/orders are deleted. No real record is deleted by tests or preview.

## Tasks

- [x] Dedicated `portal/forms/provision-description-delete.js`: preview(id) returns opaque context with id, supplier and children [{id,supplier,product,status}]; remove(context,{confirm:true}) deletes conditionally and returns {id,deletedChildIds,deleted:true}. Tests in mobile/tests/provision-description-delete-data.test.mjs.
- [x] Expose previewDeletion/deleteDescription only on the grouped pending-provision data provider, using the same repository/session authorization.
- [x] Add popup X, loading/complete/error/partial confirmation and No/Yes actions; preserve reminder list on No and remove verified deleted entry. Tests: chat-view.test.mjs and app-controller.test.mjs.
- [ ] Verify focused tests, complete app suite/build, gesture guard and browser layout/behavior using synthetic data.
- [ ] Independent review, PR, merge; publish web/Windows plus iOS TestFlight and Android internal release and verify each channel.

## Ledger

- Baseline origin/main 770b57f8. Existing isolated worktree, clean new feat/delete-pending-provision-description-20261018 branch.
- User has already authorized implementation/publication without additional approval prompts. Confirmation inside the requested app remains mandatory.
- Browser QA: synthetic No/Yes flow, red X below check, complete confirmation, no horizontal overflow at 320/390/1365; two 390px screenshots inspected. Initial involved suites: 816/816 pass. Initial portal suite: 1076 pass, 6 skip.
- Independent review findings reproduced RED: async write-token acquisition could outlive session, and a child could arrive at the parent-removal boundary. Fixes: assert after token await AND guarded fetch for Graph/REST; parent uses opaque REST recycle receipt, post-removal full scan, restore original parent on new child/read failure, and fresh confirmation. Each has regression tests.
- Ruling: SharePoint text foreign keys have no cross-list transaction. Use compensating parent restoration rather than schema changes or deleting unshown concurrent children. A failed restore/lost receipt is explicit incomplete/manual recovery, never success; external writes after completed deletion cannot be prevented by this client. No real record was deleted in testing.
- Repository recycle/restore primitives follow Microsoft primary docs: https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-visio/jj247053(v=office.15) and https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-visio/jj246549(v=office.15). Receipts bind exact repository/site/list/item; no arbitrary bin GUID restore.
