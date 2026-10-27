# Camera Photo Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline.

**Goal:** Offer `🖼️ ESCOLHER FOTO GALERIA` first in the existing camera menu and attach already taken images.

**Architecture:** Reuse the shared camera chooser and `native.pickPhotos()` on Android, iOS and web. Accept the new `gallery` result in composer/form capture and attachment-page append.

**Tech Stack:** JavaScript, Capacitor, browser file input, Node test runner, JSDOM, Vite.

**Spec:** `docs/superpowers/specs/2026-10-27-camera-photo-gallery-design.md`

## Global Constraints

- Exact first label: `🖼️ ESCOLHER FOTO GALERIA`; focus the first option.
- Preserve camera, scanner, cancellation, drafts, attachments and session guards.
- Keep all 14 signature gesture blocks intact.
- Publish verified web/Windows, Play internal and TestFlight without duplicate main workflows.

## Review Focus

- Gallery selection calls the photo library, not capture or a general document picker.
- Closing the chooser or photo library leaves existing content intact.
- A previous account's delayed chooser or picker cannot upload files.
- The shared preview append route also accepts gallery images and still produces PDF.
- Long Portuguese button label remains visible on narrow screens and keyboard focus starts there.

### Task 1: Gallery selection throughout the shared camera menu

**Files:** `src/ui/document-scanner.js`, `src/app-controller.js`; existing `tests/document-scanner.test.mjs`, `tests/app-controller.test.mjs` and `tests/attachment-append-controller.test.mjs` under `apps/energetico-mobile`.

**Interface:** `chooseCaptureMode()` adds result `gallery`; consumers call existing `native.pickPhotos()` and retain their current upload/append boundaries.

**Release ruling:** `scripts/attach-testflight-build.mjs` and `tests/ci-package.test.mjs` use the direct selected-build relationship to avoid the Apple group-history HTTP500 observed in the previous release. Validate existing link, normal association read-back and ambiguous timeout recovery. The browser fixture/test for page append exercises gallery selection through a real image input at 320/390/1365px.

- [ ] Run the existing focused camera/scanner tests and signature guard as baseline.
- [ ] Extend meaningful chooser and controller tests for gallery selection, cancellation/session guards and the append route; run them RED.
- [ ] Add the first button/focus and support `gallery` in both consumers; run tests GREEN.
- [ ] Verify the chooser visually on phone/desktop; run full suite, builds, iOS verification and secrets/gesture checks.
- [ ] Obtain one fresh branch review, fix material findings, commit and push a PR.
- [ ] Wait for final-head CI, merge, observe automatic publication and verify all three targets.
