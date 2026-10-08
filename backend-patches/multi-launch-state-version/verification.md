# Verification — 2026-10-08

- Red: the new six-case suite reproduced false recovery in three valid branches and missing ETags in two; the real-conflict case already passed.
- Green: 6/6 new tests; 38/38 combined cash-receipt/recovery and state-version regressions.
- Deployment checks: 4/4 Windows and 4/4 Linux, including rollback, hash drift and exact-file confinement.
- Fresh independent review: approved, no findings.
- Current-source baseline full backend discovery: 2265 tests, 469 failures, 156 errors, 3 skips; 239 unique failing/error case identities.
- Candidate full discovery: 2271 tests, 475 failures, 112 errors, 3 skips; 221 unique failing/error case identities. Zero new failing case identities. Two previously errored inherited multiple-launch cases now reach stale pagination/navigation assertions, repeated three times by existing imported fixture suites. The legacy full backend suite remains red; this change does not claim otherwise. One unrelated completion case fluctuated and is not attributed to this fix.

Deployed 2026-10-08 22:53 UTC to /opt/energetica-whatsapp and /home/opc/energetica-build.
Backup: /var/backups/energetica-whatsapp/multi-launch-state-version-20261008T225319712449Z.

Both installed worker/workflow.py files:
2834445e70f4a4016fe1d2cd33053a3b88fc2942d59ef8903679b9fc0f6ee0a1

Previous workflow hash:
26362bf8ae23cfe25570bd94b646982906e7f30f21fa3a00a9b722aa1f68d079

Manifest SHA256:
0f72310083880744b59761e0d7a7e7fd801c6eb68d0aa81358ffca4721f96f70

Installed-code Linux regressions: 6/6. Import as service user: passed.
energetica-channel-bridge.service: active.
energetica-whatsmeow.service: active.
127.0.0.1:8765/health: {"status":"ok","channel":"generic"}.

Preserved clients.py SHA256:
8e173a55bc5c7a395ff0c0cd4b701132bd3d21353fe8e837a3a8837a76a2d49a
Preserved payment_provision_flow.py SHA256:
94d4e6f7a2fe4810fe37d652428759a75e2eca2780b8a7adcd4fa7719d2ee413

All tests and deployment proof are retained in the local multi-launch-false-error-20261008 evidence folder. No real SharePoint launches, payments or receipts were created during QA.
