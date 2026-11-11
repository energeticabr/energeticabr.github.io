# Unified bank and fiscal synchronization

> **For agentic workers:** Use superpowers:executing-plans for implementation and one fresh final review.

**Goal:** Clicking refresh in Sicoob transactions, DDA or fiscal invoices starts all three original-source collectors.

**Architecture:** Retain the authenticated durable DDA and SEFAZ sessions and add the same durable protocol for Sicoob movements. A session-owned coordinator starts all three independently and exposes each source's receipt plus combined progress. The Sicoob worker runs the existing import and enrichment scripts under a lock shared with scheduled runs. Existing identities, bank credentials, SharePoint lists, idempotency keys, fiscal cooldowns and notifications remain in use.

**Tech stack:** JavaScript/Capacitor, Python, systemd, SharePoint and existing collectors.

**Authorization:** User explicitly requests execution without confirmation and publication to Windows/web, Android and iOS.

## Constraints and review focus

- A SharePoint reload alone cannot be reported as a bank synchronization.
- Concurrent clicks must coalesce; a failed source must not prevent other starts.
- Navigation, backgrounding, connection loss and account changes must preserve durable recovery and account isolation.
- Source completion must refresh its visible data without waiting for SEFAZ cooldown; keep filters and existing rows on refresh failures.
- Scheduled/manual collection must not race or create duplicates; preserve existing attachment and financial logic.

## Tasks

- [ ] Add failing report and coordinator regression tests; verify existing source tests.
- [ ] Add authenticated Sicoob queue/worker, test idempotency, authorization, parsing, lock and failure paths; stage protected deployment with baseline hashes and rollback.
- [ ] Add shared coordinator, Sicoob session and wire all relevant reports/galleries. Verify source completion, concurrent starts and partial failures.
- [ ] Run focused tests, signature guard, builds and final independent review. Deploy backend and confirm an actual bank collection.
- [ ] Merge reviewed changes and verify Windows/web, Play internal and TestFlight publication individually.
