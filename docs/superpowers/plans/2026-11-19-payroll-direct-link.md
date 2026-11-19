# Direct payroll linking implementation plan

**Goal:** Open payroll linking immediately after a saved launch, with `❌ NÃO ADICIONAR A FOLHA DE PAGAMENTO` below the month choices.

**Architecture:** Patch the shared workflow, retaining existing selection, allocation, attachment and financial checkpoint handlers. Keep legacy yes/no replies compatible and route old decision-stage drafts into linking. Android, iOS and Windows/web consume the same server payload.

**Constraints:** No new financial writes on opening the page. Declining follows the existing no path. Choosing a month follows the existing yes path. Preserve settlement reconciliation and completed payroll rows.

## Task 1

- [ ] Add real workflow/channel tests for direct entry, decline, month/type completion, resume, multi-selection and stale/duplicate replies. Run against the baseline and observe failures.
- [ ] Add exact-anchor transformer in `backend-patches/payroll-direct-link/patch_backend.py`; bypass the decision, retain legacy replies, add the decline terminal action and handler.
- [ ] Run the regression suite against independent live/mirror candidates and the existing attachment/batch tests as applicable.
- [ ] Package the existing guarded installer with independent baseline hashes, lock, ingress gate, backup and rollback. Run installer tests and dry-run.
- [ ] Review, commit, publish server patch, and verify installed hashes, both services, health and real installed workflow with synthetic data.
- [ ] Push and integrate the reviewed patch and record deployment evidence.

User supplied the behavior and explicitly requested autonomous implementation/publication; no design approval round is needed.
