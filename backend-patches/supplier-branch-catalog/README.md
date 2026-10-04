# Supplier branch catalog validation

Supplier defaults are recommendations, not authoritative branch records. FILIAIS is the only source of selectable branch values.

The patch makes three narrow changes:

- Do not synthesize missing recommended options for a FILIAIS source.
- Recommend only an existing full branch value when applying a supplier override; never match just the numeric prefix.
- Revalidate a selected launch branch against current options, including old sessions, before storing it.

No supplier record is automatically renamed and no SharePoint record is written by the verification scripts.

See [verification.md](verification.md) for focused checks and the explicit comparison of the existing red legacy suite.

Deployment uses exact baseline hashes, unique patch contexts, a deployment lock, a final pre-install hash check, backups and rollback on subsequent errors. Production and build copies are patched separately to preserve their unrelated differences. Validation mode tests staged candidates only; apply mode installs after the same checks.

The live verification script makes read-only requests to the official FILIAIS catalog and verifies the installed selector rejects the invalid supplier default.
