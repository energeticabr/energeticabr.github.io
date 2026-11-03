# Provision settlement civil-date recovery

A grouped payment could save all its provisions and launches, then fail to
confirm completion after SharePoint automation normalized the payment date to
noon. Verification compared that date-only input with an exact midnight instant.
A retry also compared the order plan's date-only input with SharePoint's ISO
DateTime string and rejected the unchanged order.

For a schema-confirmed DateTime column and a date-only expected value, verify
the Sao Paulo civil day. Explicit timestamp expectations retain their existing
strict comparison. Different local days still fail verification.

Normalize existing order dates in new plans. Preserve a previously frozen ISO
or date-only representation only after confirming it describes the same day,
so both old and new durable settlement checkpoints remain resumable. Financial
tokens, owner checks, conditional writes, frozen values and attachment digests
retain their existing checks.

This changes the shared service used by Android, iOS and Windows/web. No client
package or UI change is required.

## Validation

- 13 regressions on the deployed Python runtime, including normalized noon
  dates, previous/next civil-day rejection, explicit timestamp checks, real
  `verify_item`, and frozen ISO order checkpoints. New cases failed before the
  corresponding correction and pass afterward.
- 49 existing SharePoint client tests passed against the candidate.
- Read-only recovery against the real service reached only the final parent
  update; record creation was denied throughout.
- The authorized interrupted settlement was resumed with an allowlist permitting
  only its final parent update. A separate read-only audit confirmed completion,
  one existing order, the five existing launches, and two distinct PDF contents
  without duplicated attachments. Private record evidence stays outside Git.
- Independent review identified frozen ISO checkpoint compatibility; the final
  correction and two regressions cover that case.
- All 14 protected signature blocks passed the repository guard; unchanged.

## Deployment

`source.patch` contains only the two production source changes. Full private
backend sources and live financial records are not included.

Run `deploy.py --check` to verify the exact independent production/mirror source
hashes and compile candidates without changing files, then `deploy.py --apply`.
The installer preserves each root's unrelated changes, saves backups, replaces
files atomically, restarts both importing services, and verifies `/health`.
Failure restores the original files and restarts the services.

`--upgrade-v1` supports the exact first deployment's hashes for the additional
frozen ISO checkpoint compatibility correction. It changes only the settlement
module; the client adapter is already corrected.

Final production SHA-256:

- `worker/clients.py`: `00e1fc61d6ae396e8f02d1bdcde52ce8b4179a296c167661516a4e17f55b119b`
- `worker/provision_description_settlement.py`: `3abff8c148e7853bea5b2de7e86f15d229c3ead3c572da5a398fc75a895af37e`

Both production services returned healthy after installation. Financial
completion and the attachment inventory were independently verified afterward.
