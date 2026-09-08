# App Review without company database access

## Request and scope

Create an honest, usable App Review account backed exclusively by synthetic data. Work only on ENERGÉTICO (App Store ID 6809887853). Do not expose corporate databases or credentials; do not implement deferred sharing/notification features. Apple approval remains external.

## Architecture

Reuse the existing native demo bootstrap and the real workflow engine through the isolated SQLite adapter. Each login gets a private session, records, attachments and audit history. Label the account as a demonstration and explain this in App Review notes. Corporate Microsoft login and production endpoints remain unchanged. No reviewer detection, simulated success or hidden production fallback.

Complete synthetic reference records and the builder wiring needed to exercise the existing workflows. Test actual confirmations, persistence, edit/delete, attachment bytes and generated documents. Empty transactional lists are valid before the reviewer creates records, but reference selectors must have coherent fictional examples.

Deploy a separate service with a dedicated Unix user, private data, root-owned code, no production environment or mounts and no network access. Caddy reaches it through a Unix socket; systemd PrivateNetwork and AF_UNIX-only sockets prevent corporate API or loopback bridge access. Deny production directories explicitly. Temporary data is resource-bounded. Create a dedicated random review password outside the checkout, never bundle or print it.

Enable the native demo choice only after the isolated service passes deployed checks. Build a new TestFlight version, use accurate screenshots and provide the dedicated credentials only to App Review. Do not represent a pending build or incomplete metadata as a released application.

## Acceptance

- Existing corporate behavior remains untouched; demo requests cannot reach corporate endpoints.
- Review account can create, inspect, edit and delete fictional items with actual engine behavior.
- Attachments, summaries, PDF generation and drafts operate on session-owned data only.
- Invalid credentials/tokens, cross-session media and traversal are rejected.
- The deployed process cannot read production files or open IPv4/IPv6 network sockets.
- Release readiness is checked for the exact new build; screenshot and credential requirements are satisfied before submission.

## Risks

Advanced workflows need reference-data relationships, not arbitrary seed rows. The VM has limited memory; constrain sessions and process memory. Demo sessions expire/reset and this must be explicit to reviewers. Share extension cannot import corporate session state into a demonstration. The App Review team may request further information; approval cannot be promised.
