# Description Gallery Linked Clusters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Large left ID and selectable linked-provision cluster on parent description cards.

**Architecture:** Reuse the published complete reader and read-only modal. Registration data exposes the reader only for provisionDescription; shared payment-format helpers keep the two entry points consistent. The parent gallery owns modal lifecycle and resolves replacement focus targets after asynchronous redraws.

**Tech Stack:** Existing JavaScript ESM, DOM, SharePoint adapter, CSS, JSDOM and Vite browser tests; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-25-description-gallery-linked-clusters-design.md

## Global Constraints

- No financial writes, relationship edits, new dependencies or schema changes.
- Keep all14 signature-protected blocks intact.
- Verify320/390px and desktop; publish same revision to web/Windows, Play internal and TestFlight only.

## Review Focus

- Parent snapshot filters/status must not restrict linked child queries.
- Metadata adapter must not turn malformed child pages into a successful empty group.
- Attachment-count redraws must keep the dialog usable and restore current trigger focus.
- Late results after close, refresh, destroy or session change must not reappear.
- Large IDs, long supplier names and the edit button must remain readable without overflow.

### Task1: Implement and verify both clusters end to end

**Files:**
- Modify src/ui/provision-description-card.js, src/ui/registration-gallery-view.js, src/ui/registration-gallery.css and src/chat/registration-gallery-data.js under apps/energetico-mobile.
- Extract unchanged format helpers from src/ui/payment-programming-gallery-view.js into src/ui/provision-payment-format.js; share them with registration view.
- Extend src/ui/provision-description-detail-view.js only for resolving the current return-focus trigger after redraw.
- Create tests/description-gallery-linked-clusters.test.mjs and a fictitious browser fixture/test; retain and extend existing parent layout checks.

**Interfaces:** Consumes loadProvisionDescriptionGroup({repository,siteKey,normalizeItem,assertSession},id,{signal}); produces registration data.loadDescriptionGroup(id,{signal}) and the existing modal's open/close/destroy. Optional resolveTrigger(id,original) returns a current DOM trigger for focus restoration.

- [x] Add real-factory integration regressions for large left ID, clickable cluster, exact complete child list including paid/offpage rows, same financial/date formatting, read-only behavior and preserved filter/page/focus. Observe RED.
- [x] Add invalid ID, partial/malformed page, loader/retry, empty group, attachment redraw/focus, timeout/stale-result and close/refresh/destroy regressions. Observe RED for new behavior; reuse existing reader/modal coverage.
- [x] Expose the exact reader in registration data; preserve malformed response shape in metadata adapter. Extract shared formatter without changing behavior. Implement card, modal integration and focused styling. Run new and baseline tests GREEN.
- [x] Verify parent and payment layouts with browser tests and visual320/390/desktop fictitious fixtures; retain all financial/audit/edit/attachment geometry assertions.
- [ ] Run full suite, both builds, iOS verification, secret scan and guard14; obtain one independent read-only whole-branch review and resolve Important/Critical findings with RED/GREEN regressions.
- [ ] Commit/push/PR/merge; verify actual web deployment, Play internal publish and processed internal TestFlight association. Open published parent gallery and verify the new clusters and all linked children without financial mutations.
