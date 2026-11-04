# PDF text selection repair

**Goal:** Select and copy embedded PDF text, including boleto payment lines, in the existing attachment preview on iOS, Android and Windows web.

**Cause:** `pdf-preview.js` renders canvas images only. There is no selectable text at the coordinates shown on screen.

**Approach:** Use the installed PDF.js TextLayer above each rendered canvas, with scoped matching styles. Keep it aligned during pinch zoom and page refitting; cancel and release it alongside windowed canvases. Preserve the existing DDA copy action. Scanned images without embedded text remain images.

- [ ] Add a failing browser regression with a fictitious PDF: select a payment line, check alignment before/after pinch, rotated pages and mobile widths 320/390 plus desktop.
- [ ] Render the text layer; cover extraction failures and teardown/window eviction with focused tests.
- [ ] Run focused tests, complete app suite, signature guard and builds; review the diff.
- [ ] Merge the validated change and verify web deployment, Android internal publication and TestFlight processing/group availability for the containing revision.

Constraints: preserve all 14 signature gesture blocks; no new dependencies; no changes to financial data or messages.

Execution: inline, as requested by the user's standing instruction to execute without confirmation. Native worktree tool rejected the source outside this chat; isolated git worktree created inside the chat workspace instead.
