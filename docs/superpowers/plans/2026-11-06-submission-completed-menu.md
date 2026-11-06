# Completed submission replay correction

> Execute inline with systematic debugging and verification before completion.

**Goal:** Prevent successful submissions from turning into invalid-area errors.

**Architecture:** Change only completed-event routing in the shared Python backend. Preserve the existing success receipt, duplicate checks, financial checkpoints and normal menu choices.

**Spec:** User report and screenshot of “ÁREA NÃO RECONHECIDA” after a successful launch.

- [x] Reproduce delayed answers, second submit clicks and lost deduplication in real-engine tests with synthetic storage.
- [x] Replay completed confirmations, check duplicates before menu routing and carry processed IDs into the next menu state.
- [x] Run regression and existing completion/navigation tests; inspect the exact diff and signature guard.
- [x] Package pinned source with lock, ingress drain, atomic installation, backup, health check and rollback.
- [x] Publish and independently read back the shared backend used by Android, iOS and Windows/web.

Publication verified at 2026-11-06T19:12:37Z. The first attempt rolled back
cleanly after a slow startup. A bounded longer polling window and matching
ingress watchdog were tested before retrying. A concurrent payroll-catalog
update was preserved by rebuilding from its hash-pinned active source.
Final installed hash and health evidence: `backend-patches/submission-completed-menu/publication.json`.
