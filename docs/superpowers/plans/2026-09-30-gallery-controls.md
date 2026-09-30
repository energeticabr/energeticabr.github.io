# Gallery controls implementation plan

**Goal:** Search existing filter options and expose right-side pencil/delete actions on every mobile gallery record.

**Spec:** User requests in this chat, including explicit confirmation to execute both tasks. Delete asks exactly `Tem certeza que deseja deletar o item de ID X?`, with Sim committing and Não cancelling. Existing closed fields and dependencies remain enforced.

**Architecture:** A searchable-select enhancer retains native select values and filter callbacks. A shared record-action dialog uses the existing PowerApps-aware form renderer and conditional SharePoint mutations. Launches reuse their established backend editor and delete operation.

**Global constraints:** Preserve all 14 protected signature blocks; no live data mutation during validation; no free text replacement for closed choices; no wildcard ETag; publish validated main to web and Google Play internal, TestFlight when workflow dispatch access is available.

## Tasks

- [x] Filter search: add reusable enhancer, integrate auto-filter lifecycle and registration toolbar plus payment sort. Test accents, choices, keyboard, reset, dynamic options, and unchanged gallery until selection.
- [x] Record data: load proven edit contracts and typed metadata; pin ETag in owned editor contexts; reject unknown/readonly fields and invalid closed choices. Extend all list services and HR wrappers.
- [x] Record action UI: accessible dialog with pencil and red-filled X; exact confirmation, cancellation, errors, duplicate submit protection, focus restoration, and closed-field editor.
- [x] Gallery integration: all launches/orders/tasks/payments/recurring/registration kinds/HR galleries; close/destroy lifecycle; refresh list after success; controller HR mutation session guards. Test each gallery's visible actions and accepted/cancelled deletion.
- [ ] Verification and publication: focused tests, full suite, mobile/PWA build, signature guard, secrets check, independent review; fix findings, create PR, merge required checks, follow uploads.

## Review focus

- Typing a filter option must not trigger a gallery request or silently change a selected filter.
- Cancelling deletion must never write; repeat confirmation cannot issue duplicate writes.
- Conditional conflicts preserve user input and the displayed item until a confirmed successful mutation.
- Hidden/closed galleries cannot receive stale editor completion or restore detached focus.
- Forms preserve closed sources, required/readonly fields and dependent selections; unknown metadata fails closed.

## Coordination

Filter worker owns enhancer, auto-filter integration and CSS import; data worker owns services; action worker owns shared UI. Root owns gallery wiring, controller and integration tests. No concurrent edits of gallery view files.

## Verification evidence

1,216 mobile tests pass; mobile and PWA builds pass; 14 protected gesture blocks match origin/main. Independent review findings were reproduced and fixed: stale launch pencil continuation, multiple relationship selections, and loading cancellation. Chromium previews at 320px/390px/tablet widths show no horizontal overflow. Real application source for additional Form43 display locks remains unavailable; this change reuses the existing proven edit contract. Publication is pending the PR integration.
