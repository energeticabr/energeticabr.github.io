# Verification record

## Scope and focused validation

- Shared runtime change in `worker/workflow.py` only; no mobile source or native projects changed.
- Fresh production baseline: `7c77bb2b4a4cf201120b8ca5f7d4efa4d56e3873343ecfa555dbb95386dfdc8d`.
- Reviewed candidate: `2b538443ab1a8165fb636cb194e41cb2971cad34f88c7e95df32c700aa40b785`.
- Independently transformed mirror: `45bf670e109838db6277debc6fa11ff4c2a7d03865d31b0e2ef73470cda58a91`.
- 24 real ChannelBridge/WorkflowEngine/LocalStateStore feature tests pass. They cover both modes and mixed combinations; supplier-specific month resolution; prior/next month and year rollover; displayed-month rollover; missing/ambiguous sheets; query failure; drafts with prior answers; verified rows; stale and duplicate controls; retry after partial verification; and process termination before the first write with the collective type durably saved.
- 54 archived launch/settlement regressions pass through a test-only adapter that chooses the new individual mode before exercising each old per-line scenario.
- Seven installer tests pass on Linux: source/input drift rejection, independent roots, backups, rollback after restart failure, concurrent drift preservation and service health.
- Actual app conversation store and renderer: 12 synthetic views at 320, 390 and 1200px, four new questions each, with no horizontal overflow or browser exceptions. The 320px mode and 390px month screenshots were visually inspected.
- Signature guard before/after reports 14 protected blocks intact.
- Independent source review found one Important issue (collective type durability), reproduced and fixed. Follow-up found no Critical/Important issues. Scoped individual buttons and exact-month lookup were added for its additional observations.

## Broader regression and publication

Full private backend baseline/candidate comparison and production publication are pending. Local behavior tests, installer tests and source review alone are not publication evidence. The complete backend includes legacy failures; their exact comparison will be recorded before rollout.

Android, iOS and Windows/web use the same published runtime; new client binaries are unnecessary for this patch.

## Deferred minor

Typed legacy payment-type controls remain supported. Scoped controls are generated only by the explicit individual mode; normal forward flow does not switch to collective mode. An externally reconstructed draft switching modes while preserving old controls is not a supported transition.
