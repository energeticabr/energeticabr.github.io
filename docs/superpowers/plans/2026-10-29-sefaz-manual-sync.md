# SEFAZ Manual Sync Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development for the independently owned tasks below.

**Goal:** Botão SEFAZ consulta três fontes e mostra conclusão persistente após navegação/reabertura.
**Architecture:** Portal authenticated durable queue, native existing fiscal collectors, global account-owned session monitor and acknowledgement dialog.
**Tech Stack:** Python VM, PowerShell Windows, JavaScript app, existing Power Automate delivery.
**Spec:** `docs/superpowers/specs/2026-10-29-sefaz-manual-sync-design.md`.

## Global Constraints

- Preserve protected signature blocks; run guard before/after.
- Preserve daily 09/15/20, certificate location, NSUs, cooldown, PDF and WhatsApp paths.
- No secrets/real fiscal documents in Git; no new endpoint carrying arbitrary commands.
- Publish same reviewed revision to Pages, Android internal and TestFlight without duplicate dispatch.

## Review Focus

- Lost create response and simultaneous clicks must resolve to one durable request.
- Closing app before completion must recover popup, including empty result, and require explicit acknowledgement.
- Cooldown/partial or unconfirmed delivery must never show a successful three-source search.
- Concurrent scheduled/manual workers must preserve cursor/locks and a retried completion must not reconsult completed sources.
- Logout, account switch, storage failure and corrupt payload must not leak or silently discard results.

## Task 1 — Queue and authenticated portal bridge (backend agent)

- [ ] Write failing Python tests for idempotency, owner isolation, active coalescing, pending/ack persistence, per-source progression and expired lease recovery.
- [ ] Implement `backend-patches/sefaz-manual-sync/sefaz_sync.py` and hash-checked installer using existing authenticated bridge; return exact spec contract.
- [ ] Test forbidden input, malformed counters, lost replies, concurrent claim, completed sources and unacknowledged result retention.
- [ ] Stage/deploy only after review, preserving bridge changes and fiscal state; verify health and authenticated read path.

## Task 2 — Native manual collector (root)

- [ ] Write failing PowerShell tests for three-source execution, cooldown wait, delivery failures, resumed completed source and concurrent locks.
- [ ] Implement `src/ManualFiscalSync.psm1` and `scripts/Invoke-ManualFiscalSync.ps1`, invoking existing source workers through fixed adapters.
- [ ] Allow strictly validated manual slots in `src/AuxiliaryFiscal.psm1`; retain daily slot semantics and tests.
- [ ] Extend transactional runtime installer and add hidden interactive scheduled worker using existing credentials; preserve all state.
- [ ] Exercise real portal request through actual worker; success must derive from source and SharePoint receipts.

## Task 3 — Persistent app monitor and dialog (frontend agent)

- [ ] Test client fixed actions/envelope, monitor restore/visibility/ack/account separation, and actual gallery button route.
- [ ] Implement fiscal client, global monitor/session/dialog, wire app authentication lifecycle and fiscal gallery sync.
- [ ] Verify empty/partial/error/cooldown text and 320/390px dialog using fictitious data, no repeated modal after acknowledgement.
- [ ] Run focused suite, mobile/PWA builds and guard.

## Task 4 — Integrate and publish (root)

- [ ] Review cross-layer contract and request independent code review; resolve findings.
- [ ] Prove live button triggers durable three-source request, leave screen/reopen and verify unacknowledged popup.
- [ ] Commit safe overlay, create PR, merge with checks; confirm Pages/Android/TestFlight and actual app result.
