# Verification evidence

Fresh production Python source and mirror Python tests were collected read-only on 2026-10-19. Before implementation, 11 of the initial 12 focused integration cases failed because child-to-launch/order copies were absent or invalid destinations were accepted. The existing mirror handled only child-to-description-parent attachments.

Final focused result: **29 passed** (19 propagation tests and 10 package/installer tests). These execute real settlement and attachment code against synthetic remote boundaries. No real financial writes or uploads were performed.

Explicit duplicate checks seed both launch and order with the source/session bytes under unrelated filenames, settle twice, and verify unchanged destination collections and unchanged financial IDs. The grouped case retains one order/two launches and performs zero uploads. The standalone session case retains one order/one launch and uploads only the new session original to its provision. SHA-256, rather than the source filename, controls reuse.

The real reviewed patch passed `git -c core.autocrlf=false apply --check` and application to a private baseline copy. All three resulting file hashes match the manifest. The real private tar passed installer scope/hash checks, baseline drift checks against both local snapshots, and candidate compilation. No remote installer check or rollout was run.

The broader PC comparison used identical legacy test/config fixtures for production baseline and candidate. Both runs produced **1350 failed, 768 passed, 3 skipped, 11 collection errors, 5 warnings** across 2132 JUnit cases; the sets of failed/error test identities are identical. This is evidence of no additional failure in that legacy fixture, not a claim that the legacy suite passes. Full named results and traces stay in the private handoff evidence directory.

Self-review covered individual source ownership, shared-order union, immutable source files, target/backlink validation, deterministic collision refusal, all-file preflight, content verification, lost responses, completed-journal reconciliation, preserved financial creation tokens/ETags, package allowlisting and rollback. Main-agent independent review and any rollout remain pending. SharePoint has no cross-item transaction; live version/link checks cannot eliminate a change occurring immediately after the last read. Hashing and buffering one child's attachments also has request/memory cost proportional to its files.
