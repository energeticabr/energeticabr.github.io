# Diary network recovery implementation plan

Goal: resume an interrupted diary PDF without queuing more workflow requests, and submit diary 231 with its 12 photos.

Evidence: production stack showed a 4284x5712 HEIC being repeatedly encoded at original resolution under the shared bridge lock. Resume requests waited at portal_authorize until their 30-second client timeout. Originals and draft survived.

- [ ] Add failing registry, client and controller tests: identity isolation; running PDF prevents input_continue; completion resumes exactly once; cancellation and older server fallback.
- [ ] Add identity-scoped running-job discovery to diary_progress and the authenticated bridge route, outside the workflow lock. Poll before resuming; show actual progress and preserve recovery blocking on failure.
- [ ] Bound photo encoding to 1600px before quality retries, close intermediate resized images, and prove the real builder still produces valid small PDFs with oriented photos. Keep originals until normal consolidation succeeds.
- [ ] Deploy guarded backend patches with source hash checks, backup, compile and health/readback checks.
- [ ] Render and inspect diary PDF; submit through the existing conversation flow; read back SharePoint fields and attachments for record 231.
- [ ] Run signature guard, focused/full mobile tests, native/PWA builds, review, merge and verify web, Android internal and iOS TestFlight publication independently.

Execution: inline, as requested by the user's standing instruction. No approval pause. Keep protected signature blocks unchanged.
