# DDA supplier history count

> **For agentic workers:** Use superpowers:executing-plans to implement and verify this change.

**Goal:** Show a compact blue count below each supplier in the DDA report.

**Architecture:** Derive one count per supplier CNPJ from the complete DDA snapshot before report filters or pagination. Reuse the existing authenticated SharePoint read. No new backend, permissions, mutations or financial-record changes.

**Tech Stack:** Existing JavaScript report model/view, CSS, node:test/JSDOM and browser fixture.

## Design and scope

The request uses “notas” in the DDA report. Source inspection distinguishes DDAS SICOOB from invoices in orders/launches; an optional clarification was offered. In the absence of a response, the stated assumption is to use the list feeding this report. Label the result explicitly as “DDAs registrados”, never as a fiscal invoice count. Include all statuses and dates still present in the list. Count list records, not just visible rows, and match normalized CNPJ rather than supplier display names. Preserve leading zeros and support opaque alphanumeric identifiers without claiming tax-document validation. Missing/unusable CNPJ yields an unavailable indicator, never a fabricated zero or a name-based match.

## Review focus

- Same name with different CNPJ must not combine; name variants with the same CNPJ must combine.
- Filters, pagination and printed output must preserve the full historical count.
- Missing CNPJ, partial reads and stale asynchronous refreshes must not produce false counts.
- Compact landscape phone and desktop layouts must remain readable.
- Existing payment overrides, totals, reminders and protected signature blocks remain intact.

## Steps

- [x] Read repository rules, verify signature guard, inspect live sources and pass baseline report tests (22).
- [x] Add regression tests for identity, full-history counts, missing documents, refresh and print.
- [x] Add model aggregation, supplier cluster and fictitious fixture examples.
- [x] Run focused tests, build and visual checks; obtain independent code review. No blocking findings; clarified unavailable-CNPJ wording. Browser layout verified at 320/390 portrait, 844 landscape and 1365 desktop using fictitious data.
- [ ] Commit, PR, merge and verify web, Android internal and TestFlight publication.
