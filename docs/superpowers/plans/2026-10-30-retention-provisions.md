# Automatic Tax-Withholding Provisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one idempotent payment provision per retained fiscal invoice and reuse one monthly description due on the following month's day 20.

**Architecture:** A focused Power Automate action builder extends the existing sequential invoice receiver after fiscal persistence. Existing unique `FOLHAOPERACAO` fields provide parent and child idempotency; a post-child reconciliation recomputes the parent total from every linked child.

**Tech Stack:** Node.js flow generators and tests, Power Automate WDL, SharePoint REST, existing Power Platform authenticated deployment.

**Spec:** `docs/superpowers/specs/2026-10-30-retention-provisions-design.md`

## Global Constraints

- Due date is day 20 of the month following `DATA_EMISSAO`.
- One parent per due month; one child per fiscal access key.
- Child business fields are only due date, `QTD=1`, retained total, and supplier name in `OBS`.
- Do not double count the NFS-e declared `TOTAL_RETIDO`.
- Do not provision CT-e, outgoing, cancelled, substituted, incomplete, or zero-retention documents.
- Preserve the existing sequential receiver, attachment, acknowledgement, and replay guarantees.

## Review Focus

- December invoice rolls over to January of the following year.
- A replay after child creation but before parent update repairs the aggregate without duplication.
- Two retained invoices in the same batch reuse the same parent.
- NFS-e aggregate social contributions are counted once.
- SharePoint returns an existing parent or child with a missing/invalid ID and the flow must fail rather than mislink records.

---

### Task 1: Retention provision action contract

**Files:**
- Create: `backend-patches/notas-fiscais-cte-nfse/scripts/retention-provision-flow.mjs`
- Modify: `backend-patches/notas-fiscais-cte-nfse/scripts/build-flows.mjs`
- Modify: `backend-patches/notas-fiscais-cte-nfse/scripts/build-live-flows.mjs`
- Create: `backend-patches/notas-fiscais-cte-nfse/tests/retention-provision-flow.test.mjs`
- Modify: `backend-patches/notas-fiscais-cte-nfse/tests/flow-fixture.mjs`
- Modify: `backend-patches/notas-fiscais-cte-nfse/tests/wdl.mjs`

**Interfaces:**
- Consumes: the existing document-loop actions, fiscal `Campos_finais`, `Nota_gravada`, and configured personal SharePoint site.
- Produces: `addRetentionProvisionActions(actions, config)` and `addRetentionProvisionVariables(actions, previous)` used by both generated flows.

- [ ] **Step 1: Write failing tests for eligibility, withholding totals, due-month rollover, monthly reuse keys, child field minimality, reconciliation, and acknowledgement ordering.**
- [ ] **Step 2: Run `node --test backend-patches/notas-fiscais-cte-nfse/tests/retention-provision-flow.test.mjs` and verify the missing builder/action failures.**
- [ ] **Step 3: Implement the minimal action builder and wire it into both generators.**
- [ ] **Step 4: Run the focused test and the unified fiscal test suite; verify all pass.**
- [ ] **Step 5: Commit the generated definitions, sources, tests, spec, and plan.**

### Task 2: Safe live publication and evidence

**Files:**
- Create: `backend-patches/notas-fiscais-cte-nfse/scripts/Deploy-RetentionProvisions.ps1`
- Create: `backend-patches/notas-fiscais-cte-nfse/tests/retention-provision-deploy.test.mjs`
- Create: `backend-patches/notas-fiscais-cte-nfse/docs/RETENTION-PROVISIONS.md`
- Generate: `backend-patches/notas-fiscais-cte-nfse/powerautomate/02-Sincronizar-NFe.definition.json`
- Generate: `backend-patches/notas-fiscais-cte-nfse/powerautomate/03-Receber-NFe.definition.json`

**Interfaces:**
- Consumes: generated receiver definition and existing authenticated Power Platform session.
- Produces: started live receiver with empty-batch smoke evidence and read-only schema verification.

- [ ] **Step 1: Write a failing deployment-contract test for exact flow identity, pre-patch backup, started-state preservation, empty-batch smoke, and receipt verification.**
- [ ] **Step 2: Run the focused deployment-contract test and verify it fails because the deployment script is absent.**
- [ ] **Step 3: Implement the guarded deploy/verify script and operational documentation.**
- [ ] **Step 4: Run all fiscal tests, signature guard, and flow generation checks.**
- [ ] **Step 5: Publish the receiver, run the empty-batch smoke, re-read the live definition, and record evidence without creating financial records.**
- [ ] **Step 6: Commit publication tooling and evidence metadata.**

