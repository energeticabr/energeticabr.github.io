# Pending Payment Provisions Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show authenticated SharePoint attachments per overdue or due-today payment and restore predictable, user-controlled reminder timing without reopening the popup during ordinary navigation or app resume.

**Architecture:** Keep the existing backend snapshot as the source for which payment provisions are due. Reuse the app's existing delegated SharePoint repository and attachment transport for `PROVISÃO PGTOS`, so attachment metadata and file bytes are read directly from SharePoint under the signed-in Microsoft account. Keep reminder preferences persisted per account and distinguish a true controller start from background/foreground transitions.

**Tech Stack:** JavaScript ES modules, MSAL/Capacitor auth, SharePoint Graph/REST repository, existing media preview/share ports, CSS, Vite.

**Spec:** User request and attached screenshot in the 2026-09-23 conversation.

## Global Constraints

- Preserve the existing SharePoint storage model; do not copy attachments into a new public location.
- Reuse `SHAREPOINT_SITES`, `createSharePointRepository`, and the authenticated attachment transport already used by Galeria de Pedidos.
- Keep the current due-payment snapshot endpoint and its due-date filtering unchanged.
- Preserve all locked signature-gesture blocks and run `pnpm guard:signature-gestures` before and after mobile-app edits.
- Publish the resulting app to the currently supported web, Android, and iOS distribution workflows after the app change is ready.

## Review Focus

- Zero attachments: render a genuinely disabled gray arrow; one or more attachments: render an enabled red arrow.
- SharePoint permission or network failure: keep the reminder usable, show an understandable unavailable state, and do not mislabel an unknown count as a confirmed empty list.
- Many overdue payments: keep the popup within the viewport and make the payment list independently scrollable.
- Close then choose a reminder interval: preserve the selection per Microsoft account and avoid reopening before that interval.
- Background/resume and screen navigation: do not clear the current-session suppression or reopen an already handled popup.

---

### Task 1: Add a SharePoint attachment data adapter for pending provisions

**Files:**
- Modify: `apps/energetico-mobile/src/chat/orders-gallery-data.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`

**Interfaces:**
- Add a factory for `PROVISÃO PGTOS` that returns `listAttachments(paymentId)` and `downloadAttachment(paymentId, fileName)` using the existing SharePoint repository and per-account delegated token provider.
- Preserve the existing `createOrdersGalleryData()` defaults and behavior for `NOTASPENDENTES`.

- [x] Add optional list key/name aliases to the shared gallery data adapter while retaining the current defaults.
- [x] Export a focused pending-provision attachment factory configured for the existing `personal` SharePoint site and `PROVISÃO PGTOS` aliases.
- [x] Lazily create/cache the attachment adapter for the active account; request incremental SharePoint authorization using the existing `auth.getToken` / `auth.authorize` pattern.
- [x] Reset the cached adapter and per-payment attachment metadata when the account/session changes.
- [x] Build the app with Vite and inspect the targeted diff.

### Task 2: Add expandable per-payment attachment rows and preview/share actions

**Files:**
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/styles.css`

**Interfaces:**
- Controller state exposes each payment's attachment status (`loading`, `available`, `empty`, or `error`), descriptors, and the currently expanded payment ID to the view.
- A payment attachment descriptor uses `{ fileName, mimeType, size }`; opening or forwarding it downloads that exact SharePoint attachment through the adapter and delegates to existing `showMedia` / `native.exportMedia` ports.

- [x] Load attachment metadata for due payments with bounded concurrency and cache the results for the active session.
- [x] Render a red enabled down-arrow when metadata confirms one or more attachments, a gray disabled arrow only for a confirmed empty list, and an explicit unavailable/loading state for unresolved metadata.
- [x] Expand only the selected payment, list its attachments, open each attachment through the existing preview path, and add a per-file forward/share action through `native.exportMedia`.
- [x] Widen the dialog and cap it to the available dynamic viewport height; keep the payment list scrollable inside the dialog.
- [x] Run the signature-gesture guard, build the app, and review responsive dialog sizing and internal scrolling in the targeted CSS.

### Task 3: Restore reminder choice and one-display-per-app-open behavior

**Files:**
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/styles.css` (only if reminder layout needs adjustment)

**Interfaces:**
- Closing the pending-payments popup, including its close button or backdrop, opens the existing reminder-choice dialog.
- `always`, `2h`, `today`, and custom-hour choices keep their existing persisted per-account representation and notification scheduling.

- [x] Route close/backdrop through `closePendingProvisions()` so the user is asked when to be reminded again.
- [x] Remove the session-dismissal reset from background handling; reset it only at a true controller/app start or account change.
- [x] Prevent foreground refreshes from replacing an open reminder-choice dialog or recreating a popup already suppressed for this session/interval.
- [x] Build the app, run the required signature guard, and inspect reminder/modal state transitions in the implementation.

### Task 4: Publish the app update

**Files:**
- Modify: platform build outputs generated by the existing project workflows; no checked-in binary changes unless the current release workflow requires them.

- [ ] Create and merge a pull request for the app changes after review.
- [ ] Publish the web build and trigger the existing Android and iOS distribution workflows.
- [ ] Report actual workflow and distribution status; distinguish a submitted iOS build from a build already visible on the device.
