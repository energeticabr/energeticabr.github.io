# Galeria Validar Presenças Implementation Plan

> Execute inline; user authorized implementation and publication without questions.

**Goal:** Add a separate HR gallery based on DESCRITIVOPRESENCA.
**Architecture:** Share the existing presence-description model and native gallery, including filters, editor and attachment viewer. Add a separate action/kind/title without changing the validation workflow or automatically validating records.
**Tech Stack:** Existing JavaScript/Capacitor/PWA and SharePoint repository.
**Spec:** User request and screenshot in this chat.

## Global Constraints
- Preserve all 14 signature gesture blocks and the existing presence history gallery.
- Place the new gallery beside Validar Presenças Apontadas; move Funcionários RH to the following row.
- Keep all records and existing presence/status filters; no new pending-only criterion was requested.
- Publish web/Windows, Android internal and TestFlight for the same merged revision.

## Review Focus
- Local opening sends no VM command or writes.
- Attachments open for the selected ID.
- Source pagination remains complete.
- Existing editor uses the same G17 contract.
- Short menus and narrow screens retain all shortcuts once.

### Task 1
- [ ] Add failing model/data/UI/controller/menu tests.
- [ ] Add shared model and new route/menu shortcut.
- [ ] Run focused tests, gesture guard, 320/390/1365 layout checks and builds.

### Task 2
- [ ] Review, commit, push and merge after checks.
- [ ] Verify web, Android internal and TestFlight separately.
