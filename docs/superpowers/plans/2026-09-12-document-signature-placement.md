# Document Signature Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Let the document-signing flow choose a normalized PDF position and either repeat the signature on every page or place it only on the final page.

**Architecture:** Keep the existing transparent signature extraction in `worker/document_signature.py`, extending `sign_pdf` with a validated scope and nine named placement anchors. The workflow will persist the two choices after receiving the signature image, expose them as structured options, and invoke the PDF builder only after both choices are present; legacy states continue using centered bottom placement on all pages.

**Tech Stack:** Python 3.9, pypdf, Pillow, ReportLab, existing declarative/structured WhatsApp polls, unittest.

**Spec:** `docs/superpowers/specs/2026-09-12-document-signature-placement-design.md`

## Global Constraints

- Preserve transparent background extraction from the signature image.
- Support `all` and `final` signature scopes.
- Use normalized coordinates so page sizes can differ.
- Keep legacy state behavior as centered bottom on all pages.
- Keep the original PDF unchanged and produce a new signed file.

---

### Task 1: Extend PDF signing geometry

**Files:**
- Modify: `C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/worker/document_signature.py`
- Test: `C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/tests/test_document_signature.py`

**Interfaces:**
- Consumes `sign_pdf(document, signature, original_filename=None, scope="all", position="bottom-center")`.
- Produces a signed PDF where `scope` is `all` or `final`, and `position` is one of nine named anchors.

- [ ] **Step 1: Write failing tests** for all-page and final-page scope, a non-default anchor, normalized placement across differently sized pages, and invalid scope/position.
- [ ] **Step 2: Run the focused tests** with `python -m unittest -q tests.test_document_signature`; confirm the new assertions fail before implementation.
- [ ] **Step 3: Implement validation and anchor conversion** in `document_signature.py`, preserving current defaults and transparent image crop.
- [ ] **Step 4: Run the focused tests** again and confirm all placement cases pass.
- [ ] **Step 5: Commit** the geometry change with its tests.

### Task 2: Add workflow configuration choices

**Files:**
- Modify: `C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/worker/workflow.py`
- Modify: `C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/worker/workflow_config.json`
- Test: `C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/tests/test_document_signature.py`

**Interfaces:**
- Adds `DOCUMENT_SIGNING_WAITING_CONFIGURATION` and persisted `document_signing_scope`/`document_signing_position` fields.
- Structured replies `document_signing_scope_all`, `document_signing_scope_final`, and `document_signing_position_<anchor>` drive the existing state machine.

- [ ] **Step 1: Write failing workflow tests** proving the signature upload returns a configuration question, scope selection returns position choices, all-pages and final-page choices produce the expected signed output, and the final-only screen does not include the all-pages option.
- [ ] **Step 2: Run the focused workflow tests** and confirm they fail because the current flow signs immediately.
- [ ] **Step 3: Implement the configuration stage**, prompt helpers, reply handling, state cleanup, retry prompt, and captions for both scopes.
- [ ] **Step 4: Update the document-signing copy** in `workflow_config.json` so the user knows the signature placement is configurable.
- [ ] **Step 5: Run `python -m unittest -q tests.test_document_signature tests.test_workflow`** and confirm the complete workflow suite remains green.
- [ ] **Step 6: Commit** the workflow and configuration change with its tests.

### Task 3: Validate the production package and publish

**Files:**
- Modify: no application source files beyond Tasks 1–2.
- Test: `C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/tests/test_channel_bridge.py`

**Interfaces:**
- The existing portal and mobile clients consume the structured polls without a new HTTP contract.

- [ ] **Step 1: Run backend compilation and the focused signature/channel tests.**
- [ ] **Step 2: Run the mobile app test suite and production web build.**
- [ ] **Step 3: Stage the tested backend source and deploy it through `scripts/deploy-codex-full-backend.sh`, verifying health, service state, and WhatsApp connection.**
- [ ] **Step 4: Commit any final integration tests and publish the app branch so Android CI builds the updated APK.**
- [ ] **Step 5: Record the final commit, CI result, and artifact path.**
