# Correction PDF navigation implementation plan

**Goal:** Opening an invoice DANFE includes its own correction letters in Previous/Next navigation.

**Cause:** The authenticated DANFE link supplies a singleton collection, bypassing the invoice attachment list.

**Approach:** Keep the original DANFE first, refresh the same invoice's attachment list, append correction PDFs before other files, and deduplicate the DANFE by filename. Preserve lazy authenticated downloads and standalone XML/document links. Fail visibly on an attachment lookup error rather than silently omit corrections. Ignore late responses after the gallery closes.

- [ ] Add a failing regression covering DANFE plus correction, refreshed attachment reads, lazy sources, original deduplication, same-record ownership and stale-gallery responses.
- [ ] Update fiscal PDF link collection construction and verify focused gallery/preview tests and signature guard.
- [ ] Build native/web bundles, run relevant browser regressions, review the diff and merge validated changes.
- [ ] Verify served web assets, Android internal distribution and iOS TestFlight processing/group association for the integrated revision.

User authorized implementation and publication without further confirmation. Native worktree creation did not return; an isolated Git worktree was created in this task's app folder.
