# Silva Novais daily capture implementation plan

> Execute inline with executing-plans; final independent review required. User explicitly authorizes execution and publication without approval questions.

**Goal:** Attach original accounting PDFs to the matching monthly provisions and repeat daily on OCI.
**Architecture:** Extend the existing backend email family with a dedicated queue/flow and an attachment-only worker; reuse the established SharePoint adapter, lock and provenance conventions.
**Tech stack:** Python 3.9+, pypdf on OCI, Power Automate Outlook/SharePoint, systemd.
**Spec:** ../specs/2026-11-05-silva-novais-email.md

- [ ] Write failing tests for email validation, cross-month identity, strict target selection, safe downloads and duplicate protection.
- [ ] Implement parser, cache, exact attachment reconciliation, cloud queue and daily capture definition.
- [ ] Run backend suite, review, commit/PR/CI, deploy and verify cloud schedule plus OCI timer.
- [ ] Apply historical capture; verify bytes, financial fields and links, and a zero-upload repeat; report unavailable historical boletos explicitly.

Review focus: wrong company with same supplier/amount; issue vs due month and year turnover; paid records and existing documents; expired tracking links; partial or interrupted uploads and changes during attachment capture.
