# Gallery editor back button implementation plan

**Goal:** Cancel any gallery edit from a top-left arrow and return to its original gallery unchanged.

**Architecture:** Extend existing cancel/close paths; share header styling across generic and independent editors.

**Tech Stack:** JavaScript DOM, CSS, node:test, browser fixtures.

**Spec:** `docs/superpowers/specs/2026-10-30-gallery-editor-back-design.md`

## Global constraints

- No real financial or SharePoint writes during QA.
- Preserve protected signature blocks, current gallery filters, page and scroll position.
- Publish web, Android internal and iOS TestFlight after verification.

## Review focus

- Back during asynchronous load must abort the read and ignore its late result.
- Edited fields and staged attachments must never be submitted by Back.
- In-flight writes must retain the existing close guard.
- Separate editor implementations need the same accessible action.
- Long headings and mobile safe areas must keep the arrow visible without horizontal overflow.

## Tasks

- [x] Audit every gallery edit entry point and map it to the generic or independent editor.
- [x] Add focused cancellation tests for generic editor loading, dirty draft, variant/error and busy-save states; observe missing-arrow failure.
- [x] Add shared header/back action using existing close logic and focus restoration without scrolling.
- [x] Add the same action to independent editors and verify their existing cancel behavior.
- [x] Browser-check narrow and desktop headers and preservation of the gallery location; run focused tests, builds, required suite and signature guard.
- [ ] Independently review, merge and verify publication on all three targets.

## Validation ledger

372 focused tests passed, plus 8 browser tests. Portal suite: 1,278 tests, 1,271 passed, 7 skipped, no failures. Native/PWA builds and 14-block gesture guard passed. Independent review found the launch loading/error header gap; three new tests reproduced it before fixing it. Browser checks also reproduced and fixed dark hover/title contrast. Fixtures use fictitious data with zero real writes. The separate legacy `admin.html` portal is outside the Energético app routing covered here.
