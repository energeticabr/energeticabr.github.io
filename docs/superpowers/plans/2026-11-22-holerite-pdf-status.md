# Holerite PDF Status Placement Implementation Plan

> **For agentic workers:** Execution approach: inline in this session, per the user's standing instruction to execute requested changes.

**Goal:** Put the completed `100%` and PDF page/file summary to the right of `ENCAMINHAR` in the payroll report preview.

**Architecture:** Pass a payslip-only preview layout from the payroll report and add its footer status target. Move the completed status nodes there after PDF rendering; collapse the central status strip when empty and lay out footer metadata compactly. Leave other preview layouts intact.

**Tech Stack:** JavaScript ES modules, CSS, Node test runner, jsdom, Vite.

**Spec:** `docs/superpowers/specs/2026-11-22-holerite-pdf-status-design.md`

## Global Constraints

- Scope the new arrangement to `data-layout="payslip-report-pdf"`.
- Keep loading progress and errors accessible and visible.
- Preserve PDF rendering and share behavior.
- Do not edit protected signature gesture blocks.

## Review Focus

- Completed status moves only for the payroll report: assert metadata follows ENCAMINHAR and central status is empty.
- Generic reports retain their previous status location and fit behavior.
- Small screens wrap footer metadata within the modal width.

### Task 1: Place completed report status in the footer

**Files:** `src/app-controller.js`, `src/web/attachment-preview.js`, `src/web/attachment-preview.css`, `tests/app-controller.test.mjs`, `tests/attachment-preview.test.mjs`.

- [x] Add a failing DOM test for completed payslip report status placement.
- [x] Run the targeted test and confirm it fails on the existing layout.
- [x] Add a payslip-report-only footer target and move completed status content into it.
- [x] Collapse the empty central status strip and style the footer target responsively.
- [x] Run focused attachment preview tests (114 passed), controller/gallery tests (673 passed), the signature gesture guard (14 blocks intact), and the web build.
