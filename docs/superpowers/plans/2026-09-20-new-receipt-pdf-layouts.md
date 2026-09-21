# New Receipt PDF Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the EPI delivery and payment receipt PDFs to match the approved navy/light-blue A4 references while keeping all document data dynamic and excluding the signature from the base templates.

**Architecture:** Keep one focused Python generator per document type. Each generator validates and normalizes its own inputs, emits an auditable HTML representation, and renders the matching PDF with ReportLab; the workflow continues to add signatures later as a separate overlay. Preview and final signing share the same proportional geometry, while the server signer mirrors that contract for generated receipts.

**Tech Stack:** Python 3, ReportLab, pypdf, unittest, Poppler rendering.

**Spec:** Approved design in the current conversation (no separate specification file for this bounded visual change).

## Global Constraints

- The attached EPI image defines the EPI document structure and visual hierarchy.
- The attached payment image defines the payment document structure and visual hierarchy.
- All names, dates, documents, payment methods, items, quantities, units, values, and totals come from runtime data.
- The sample signature and sample values shown in the references are not static template content.
- The existing signing flow remains responsible for adding a signature after the base PDF is generated.
- Documents use A4 pages and must remain readable when item rows require additional pages.

## Review Focus

- A base document must contain no signature image, signer label, or prefilled signature name.
- Supplier documents that are blank must render a readable fallback instead of failing or leaving malformed layout.
- Long supplier and item descriptions must wrap without leaving the page bounds.
- Multi-page item tables must repeat their section and column headers.
- Monetary totals must preserve the existing line-rounding behavior.

---

### Task 1: Lock the visual and content contract in tests

**Files:**
- Modify: `C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/test_payment_receipt_document.py`
- Create: `C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/test_epi_delivery_document.py`

**Interfaces:**
- Consumes: `generate_payment_receipt_pdf(...) -> tuple[bytes, str, str]`.
- Produces: expected contract for `generate_epi_delivery_pdf(...) -> tuple[bytes, str, str]` and both approved layouts.

- [x] **Step 1: Add failing tests for the payment model**

Assert that HTML and extracted PDF text contain the approved title, metadata labels, payer/supplier sections, items section, total, footer, and runtime values; assert that signature labels and static sample values are absent. Add a 40-item case that produces more than one page and preserves the title/header text.

- [x] **Step 2: Add failing tests for the EPI model**

Assert that HTML and extracted PDF text contain the approved title, delivery date band, company/receiver sections, EPI table, declaration, footer/page numbering, and runtime values; assert that signature labels and static sample values are absent. Add a long-list case that produces more than one page.

- [x] **Step 3: Run the focused tests and verify RED**

Run: `python -m unittest -v test_payment_receipt_document.py test_epi_delivery_document.py`

Expected: failures caused by missing approved sections or the missing EPI generator module, not import/setup errors.

### Task 2: Implement the two approved PDF generators

**Files:**
- Modify: `C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/payment_receipt_document.py`
- Create: `C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/epi_delivery_document.py`

**Interfaces:**
- Consumes: normalized document data supplied by the existing workflow.
- Produces: `generate_payment_receipt_pdf(...)` and `generate_epi_delivery_pdf(...)`, each returning `(pdf_bytes, filename, html)`.

- [x] **Step 1: Build shared visual primitives inside each focused module**

Use navy `#0B3768`, pale blue `#EAF2F8`, white section titles, compact A4 margins, wrapped paragraphs, repeated table headers, and page footers. Do not add a signature block to the base story.

- [x] **Step 2: Rebuild the payment receipt**

Render the brand header with city/date, metadata cards, payer/supplier cards, item table, navy total cell, footer rule, company name, and pale geometric footer motif. Preserve exact Decimal normalization and totals.

- [x] **Step 3: Build the EPI delivery receipt**

Render the brand header, delivery-date band, company/receiver cards, EPI table, declaration block, footer rule, and page number. Preserve item validation and use `Não informado` for an absent receiver document.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `python -m unittest -v test_payment_receipt_document.py test_epi_delivery_document.py`

Expected: all focused tests pass with zero failures and zero errors.

### Task 3: Render, inspect, regress, and deploy

**Files:**
- Create: `C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/tmp/pdfs/epi-layout-sample.pdf`
- Create: `C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/tmp/pdfs/payment-layout-sample.pdf`
- Deploy: `/opt/energetica-whatsapp/worker/epi_delivery_document.py`
- Deploy: `/opt/energetica-whatsapp/worker/payment_receipt_document.py`

**Interfaces:**
- Consumes: both generator functions from Task 2.
- Produces: visually verified PDF samples and the deployed backend modules.

- [x] **Step 1: Generate representative one-page and multi-page PDFs**

Use runtime-like values that differ from the reference examples so accidental hard-coding is visible.

- [x] **Step 2: Render every PDF page to PNG and inspect it**

Run Poppler `pdftoppm -png` for each sample. Inspect header alignment, table borders, wrapping, totals, footer, page numbers, and the absence of a built-in signature.

- [x] **Step 3: Run backend and mobile regression suites**

Run: `python -m unittest -v test_payment_receipt_document.py test_epi_delivery_document.py test_payment_receipt_flow.py`

Run: `pnpm test` in `apps/energetico-mobile`.

Expected: all tests pass with zero failures and zero errors.

- [ ] **Step 4: Deploy only the two generator modules with backup and health checks**

Verify candidate imports and focused tests before replacing live files, restart `energetica-channel-bridge.service`, and confirm both local and public health endpoints plus matching deployed hashes.

- [ ] **Step 5: Re-run focused generation against the deployed modules**

Generate one EPI and one payment receipt using the live virtual environment and confirm valid `%PDF` output and approved extracted headings.

### Task 4: Keep signature preview and generated PDF identical

**Files:**
- Modify: `apps/energetico-mobile/src/web/signature-placement.js`
- Modify: `apps/energetico-mobile/src/web/pdf-signing.js`
- Create: `apps/energetico-mobile/src/web/signature-document-layout.js`
- Modify: backend `worker/document_signature.py`

- [x] **Step 1: Add regression tests for receipt dimensions, center and edge clamping**
- [x] **Step 2: Centralize the mobile document classifier and proportional geometry**
- [x] **Step 3: Make the server use the same EPI/payment card proportions and 20%–200% scale**
- [x] **Step 4: Render signed samples and visually verify the result**
- [x] **Step 5: Run mobile, backend, gesture-lock and production-build verification**
