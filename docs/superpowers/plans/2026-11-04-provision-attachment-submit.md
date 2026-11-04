# Provision attachment submission repair

**Goal:** Submit native photos from the pending provision tray with matching file extensions and MIME types, and retain actionable errors on failed files.

**Approach:** Fix the native format fallback that currently selects JPEG before consulting the actual image MIME type. Use the returned image MIME type, then explicit native format or URI format before the fallback, and use the same inference for filesystem reads. Keep SharePoint validation and duplicate protection intact.

**Scope:** `src/native/native-ports.js`, the pending provision upload controller and tray, and focused native/data/controller/UI regressions. No financial fields or signature gesture blocks change. The screenshot alone does not identify the failing file's actual MIME type; the reproduced format mismatch is a confirmed code defect.

- [x] Reproduce modern PNG selection and capture without metadata, including filesystem fallback, through the real provision data validator.
- [x] Correct format inference and expose safe validation/authentication/connection failure reasons in the queue; verify failed files remain retryable and confirmed files are not resent.
- [ ] Run focused tests, signature guard, full mobile suite, native and PWA builds, and 320/390px layout checks with fictional data.
- [ ] Review, push and integrate the fix; verify Windows/web, Android internal and iOS TestFlight publication for the same revision.

Focused verification: 665 controller/data tests, 31 native/tray tests and seven native/provision/browser tests passed. The native mismatch and hidden-error regressions failed before the correction and passed after it. The real-browser fixture checked the error reason, retry control, scroll preservation and no horizontal overflow at 320/390/1365px. Native and PWA builds passed; all 14 signature blocks are intact. Independent review found no blockers. Full local mobile suite and remote release gates are still pending at PR creation.
