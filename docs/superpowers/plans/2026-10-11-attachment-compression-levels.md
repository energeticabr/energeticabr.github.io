# Attachment compression levels implementation plan

> **For agentic workers:** Apply TDD to each component, then request a fresh review of the integrated change.

**Goal:** Restore successful signing of imported PDFs and let users select four compression levels.

**Architecture:** Keep strict server validation, normalize nonzero object generations and use the compatible classic PDF writer. Extend the existing compression workflow and portal actions with a level choice and server-side limits derived from actual file bytes. Preserve original files when constraints cannot be met.

**Tech stack:** JavaScript, pdf-lib, Python, Ghostscript, Pillow, existing Power Platform bridge.

**Spec:** User instructions in this task: low 10 MB / 25%, medium 5 MB / 50%, high 1 MB / 80%, very high 500 KB / 90%. Units are decimal, consistent with existing 500000-byte cap.

## Global constraints

- Preserve all protected signature gesture blocks.
- Preserve original until successful compressed candidate is accepted.
- Signed evidence PDFs retain their exact hash; never silently replace them with compressed bytes.
- Publish the same verified revision to web, TestFlight and Play internal.

## Review focus

- PDFs containing nonzero object generations must pass strict server parsing.
- Signature confirmation errors remain visible above the PDF controls.
- Opening a compression menu must not manufacture a compressed preview.
- Stale attachment identifiers must not compress or remove another attachment.
- Incompressible or already tiny files must retain their originals.

## Tasks

1. [x] Reproduce signing failure from logs and source PDF; add failing generation and error-display regressions; switch to classic xref writer.
2. [x] Server: add optional compression profile, enforce actual-byte target and readability floors, offer four levels through upload and portal flows. Test boundary, unmet target, cancellation and signed-PDF preservation.
3. [x] App: exercise level-menu and candidate-preview round trip; render signature failure inside the active dialog.
4. [x] Validate strict confirmation with the original problematic source and a diagnostic signature in isolated evidence storage; run focused and full tests, builds and gesture guard.
5. [ ] Review integrated branch, deploy backend with backup and drift checks, merge PR and verify all three publication channels.

**Ruling:** Continue execution without a design approval pause, following the user's explicit standing instruction to execute and publish validated changes.
