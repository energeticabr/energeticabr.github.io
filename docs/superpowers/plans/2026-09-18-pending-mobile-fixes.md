# Pending Mobile Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concluir as pendências de confirmação, EPI, assinatura e distribuição do aplicativo Energético nas trilhas de teste.

**Architecture:** O backend Python controlará a nova confirmação transacional do EPI e a ordem das mensagens; o frontend móvel manterá as correções já presentes para interação imediata e desenho por toque. O PDF assinado será preparado uma vez, mostrado ao usuário e reutilizado na gravação confirmada.

**Tech Stack:** Python `unittest`, ReportLab, pypdf, JavaScript ES modules, Node test runner, Capacitor, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-pending-mobile-fixes-design.md`

## Global Constraints

- Publicar somente no TestFlight e no teste interno do Google Play.
- Não enviar para App Store Review nem para produção do Google Play.
- Preservar as correções já existentes para popups, assinatura e navegação.
- Toda alteração funcional deve começar com teste falhando e terminar com teste passando.

---

### Task 1: Confirmation before summary

**Files:**
- Modify: `worker/workflow.py`
- Test: `tests/test_workflow.py`

**Interfaces:**
- Consumes: `WorkflowEngine._send_confirmation_actions(state)` and `WorkflowEngine._send_summary_card(state)`.
- Produces: outbound confirmation sequences whose first entry is `actions` and whose next summary entry is `image`.

- [x] **Step 1: Write the failing order test**

```python
def test_creation_confirmation_is_sent_before_summary(self):
    state, etag = self.completed_form_state()
    before = len(self.messenger.sent)
    self.engine._summarize_and_confirm(state, etag)
    sent = self.messenger.sent[before:]
    self.assertEqual(sent[0]["type"], "actions")
    self.assertEqual(sent[1]["type"], "image")
```

- [x] **Step 2: Run the focused test and verify the current image-first order fails**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_workflow.WorkflowTests.test_creation_confirmation_is_sent_before_summary`

Expected: `FAIL`, with `image != actions`.

- [x] **Step 3: Reorder every confirmation-plus-summary pair**

```python
self._send_confirmation_actions(state)
card = self._send_summary_card(state)
```

Apply the same order in normal confirmation, return-after-cancel, and restored confirmation paths.

- [x] **Step 4: Run focused summary/confirmation tests**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_workflow tests.test_workflow_drafts`

Expected: all selected tests pass.

### Task 2: EPI option filtering and preview confirmation

**Files:**
- Modify: `worker/workflow.py`
- Test: `tests/test_epi_delivery_document.py`

**Interfaces:**
- Consumes: staged unsigned PDF, staged signature, selected placement, `MemorySharePoint.ensure_item`.
- Produces: `document_signing_epi_confirmation` stage and a staged `document_signing_epi_signed_attachment` reused on commit.

- [x] **Step 1: Write failing tests for selected-product filtering**

```python
self.engine._document_signing_prompt_epi_options(state, supplier=False)
self.assertEqual([option["id"] for option in state["options"]], [802])
```

- [x] **Step 2: Write failing tests for no write before confirmation**

```python
result = engine.handle(position_event)
self.assertEqual(result["status"], "awaiting_epi_document_confirmation")
self.assertEqual(sharepoint.items, {})
self.assertEqual(messenger.sent[-3]["type"], "actions")
```

- [x] **Step 3: Run the EPI tests and verify both new expectations fail**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_epi_delivery_document`

Expected: failures because selected products remain and placement commits immediately.

- [x] **Step 4: Filter options using stable source IDs with description/unit fallback**

```python
selected_ids = {str(item.get("source_id")) for item in state.get("document_signing_epi_items", [])}
options = [option for option in options if str(option.get("id")) not in selected_ids]
```

- [x] **Step 5: Prepare and stage the signed EPI preview without SharePoint writes**

```python
signed_pdf, output_name = sign_pdf(...)
state["document_signing_epi_signed_attachment"] = self._stage_generated_document(state, signed_pdf, output_name)
state["stage"] = DOCUMENT_SIGNING_EPI_CONFIRM_STAGE
```

- [x] **Step 6: Send confirmation controls, field summary, then exact PDF preview**

```python
self._send_epi_confirmation_actions(state)
self._send_text(state, self._document_signing_epi_confirmation_summary(state))
self.messenger.send_document(..., caption="PRÉVIA DO COMPROVANTE DE ENTREGA DE EPI")
```

- [x] **Step 7: Commit only on positive confirmation and reopen placement on edit**

```python
if command == DOCUMENT_SIGNING_EPI_CONFIRM_YES_ID:
    return self._commit_epi_document_signing(state, etag)
if command == DOCUMENT_SIGNING_EPI_CONFIRM_EDIT_ID:
    return self._reopen_epi_document_signing(state, etag)
```

- [x] **Step 8: Run EPI tests**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_epi_delivery_document`

Expected: all tests pass and the committed attachment equals the preview bytes.

### Task 3: Opaque metadata band in signed PDFs

**Files:**
- Modify: `worker/document_signature.py`
- Test: `tests/test_document_signature.py`

**Interfaces:**
- Consumes: computed caption band `x`, `y`, `block_width`, `caption_height`, `block_padding`.
- Produces: a white filled rectangle restricted to the caption area below the signature image.

- [x] **Step 1: Write the failing PDF content test**

```python
content = PdfReader(io.BytesIO(signed)).pages[0].get_contents().get_data()
self.assertRegex(content, rb"1 1 1 rg[\s\S]* re[\s\S]* f")
```

- [x] **Step 2: Run the focused test and verify no filled rectangle exists**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_document_signature.DocumentSignatureTests.test_caption_has_opaque_background_band`

Expected: `FAIL`.

- [x] **Step 3: Fill only the caption band before drawing the signature**

```python
caption_band_height = block_padding + caption_height
overlay_canvas.setFillColorRGB(1, 1, 1)
overlay_canvas.rect(x, y, block_width, caption_band_height, stroke=0, fill=1)
```

- [x] **Step 4: Verify caption-band and placement tests**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_document_signature`

Expected: all tests pass.

### Task 4: Integrated verification and test-store distribution

**Files:**
- Verify: `apps/energetico-mobile/src/ui/chat-view.js`
- Verify: `apps/energetico-mobile/src/app-controller.js`
- Verify: `.github/workflows/energetico-ios.yml`
- Verify: `.github/workflows/energetico-android.yml`

**Interfaces:**
- Consumes: backend deployment and frontend branch merged into `main`.
- Produces: healthy VM, TestFlight build assigned to internal testers, Android AAB published to internal testing.

- [x] **Step 1: Run mobile regression suite**

Run: `pnpm test`

Result: 455 tests passed with zero failures, including popup, signature and release-pipeline regressions.

- [x] **Step 2: Build the packaged web application**

Run: `pnpm build`

Expected: Vite exits successfully.

- [x] **Step 3: Run focused backend regression suites and compile validation**

Run: `.\.venv-oci\Scripts\python.exe -m unittest tests.test_epi_delivery_document tests.test_document_signature tests.test_workflow_drafts`

Run: `.\.venv-oci\Scripts\python.exe -m py_compile worker/workflow.py worker/document_signature.py worker/epi_delivery_document.py`

Expected: all selected tests and compilation pass.

- [x] **Step 4: Deploy backend with backup and health checks**

Run the repository deployment script against `/opt/energetica-whatsapp`, verify both services are active, then check local and public `/health` endpoints.

- [x] **Step 5: Commit, integrate and push the frontend plan/tests if changed**

```bash
git add docs/superpowers apps/energetico-mobile
git commit -m "Fix pending mobile confirmation flows"
git push origin main
```

- [x] **Step 6: Dispatch TestFlight and Android internal workflows**

Trigger iOS with distribution enabled and every App Store review input disabled. Trigger Android with Play publishing enabled on the internal track.

- [x] **Step 7: Verify store delivery**

Confirm the iOS build is processed and assigned to the internal TestFlight group. Confirm the Android workflow uploaded the AAB to the internal testing track. Retry only failed transient steps and preserve the same non-production scope.

Result: TestFlight build 252 was processed and associated with the internal group. Android version 1.0.105 was uploaded successfully to the `internal` track. No production or App Store Review submission was requested.
