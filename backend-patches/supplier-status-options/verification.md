# Verification — 2026-10-26

- Six focused tests use the actual workflow engine, configuration, prompt and reply handlers with synthetic resumed supplier drafts. Five cases failed against the fresh baseline; all six pass after the change, with no errors or skips.
- Covers direct ATIVO/INATIVO titles and values, one-click selection of either status, inactive selection with a legacy cached menu, a stale change button, resumed prompts and intact embedded parent context. No supplier/HR/financial record is submitted.
- Eleven installer tests pass, including rejection of malformed JSON that would compile as Python, allowlisted archive members, manifest/source drift, check-only behavior and rollback.
- Independent review found no issues in the scoped source diff, stale controls, embedded return or installer.
- Signature guard: 14 protected blocks intact before and after; no client code changes.
- Manifest SHA-256: `cb086ac69eb46acfdd48e5a5ba757037a2007fad8281f6a6e4f894b195005cb2`.
- Candidate Python SHA-256: `59c4c1b4581fadfd8ea3342ae6907d118e8c369cfe16640e56b9e78ab70b5cf6`.
- Candidate configuration SHA-256: `ac33ee260f925589fd8824f8fbe9e8e94c0f60887074dd8e7c4bab39c89267f4`.
- Installer check succeeded with healthy shared services and exact candidates. Full backend sources and source archive remain private.

## Published runtime

- Released at `2026-10-26T13:27:30Z` with backup receipt `supplier-status-options-20261026T132730133239Z`. Installer returned `deployed` and health `ok`.
- Independent live and build-mirror SHA-256 reads match both reviewed candidate hashes. Channel bridge and WhatsApp services are active.
- PR installer and both signature-guard checks passed for source revision `c1c2d7e2`.
- The authenticated app opened connected to the VM. The current session had returned to the Supplies menu, so the supplier-status step was verified through the real engine fixture rather than recreating or submitting a real registration. No status was selected on the user's behalf.
- Existing clients obtain the direct choices when the question is reopened/resumed. No native/client changes or app-store distribution are required for this server update.
