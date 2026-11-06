# Fiscal synchronization status repair

**Goal:** Explain the disabled refresh control and distinguish the last completed manual request from ongoing automatic collection.

**Evidence:** On 2026-11-06 the live manual job had completed CT-e/NFS-e and NF-e was waiting for the SEFAZ cooldown. The last successful manual request was 2026-11-03. Gallery summary precedence hid the current progress.

**Scope:** Preserve request deduplication, acknowledgement, fiscal cursors, cooldowns and signature gesture locks. Do not reset/reissue the pending request or infer an automatic success from item modification dates.

- [ ] Reproduce in `apps/energetico-mobile/tests/sefaz-sync.test.mjs`: historical success must not hide waiting/error progress; pending refresh must explain its disabled state and recover when finished.
- [ ] Label historical success as a manual consultation, prioritize current notices, explain background continuation, and make cooldown metadata apply only to active requests in `src/chat/sefaz-sync-monitor.js`.
- [ ] Validate focused tests, full mobile suite, mobile/PWA builds, signature guard and browser layouts at 320/390px and desktop.
- [ ] Review, merge and publish the same revision to Windows web, Android internal testing and iOS TestFlight. Verify the live pending job without additional fiscal calls.
