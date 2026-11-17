# DDA PDF attachments on corresponding fiscal records

The OCI worker preserves the existing fiscal PDF -> DDA direction and adds the reverse direction for safely matched records. It does not change financial fields. The shared backend serves Android, iOS and Windows clients.

`build_plan` is unchanged: supplier CNPJ root/CPF, recipient, Brazilian issue day and exact cents must identify a unique installment subset with no overlapping or invalid competitors. Only collector originals named `Espelho_DDA_<16 lowercase hexadecimal characters>.pdf` are copied back. Fiscal copies and arbitrary invoice PDFs are excluded. Names on fiscal records are deterministic: `DDA-<dda id>-<original name>`.

The authenticated bridge `63618d6b-74aa-4a3d-a315-60cdd788d201` keeps inventory/PDF async behavior and adds `dda_sync`. It validates the target record/key/status and original-name envelope, creates only absent attachments, and returns downloaded stored bytes. Existing same-name content is never overwritten; the worker checks its SHA-256 against source bytes and records conflicts. DDA attachments are excluded from the old fiscal PDF selector.

Before each reverse write, the worker reloads both inventories, rebuilds the complete match and checks source bytes and name existence again. Multiple installments and multiple original collector PDFs are preserved. Reverse work, including cached source verification, has an 8-link cap per run and the existing 510-second bridge deadline. Deferred links never receive a completed receipt. Cached verification lasts at most seven days and requires unchanged fiscal revision and source manifest/hash.

Run the complete suite in a Python environment with `requests` installed:

    python -m unittest discover -v

Deploy the bridge using `Publish-ReverseBridge.ps1 -SessionScript <authenticated PowerPlatform helper>`. The helper must set `$script:flowBase` and `$script:flowAuth`. Publication retrieves the live definition, preserves its existing settings/connections, builds from that fresh snapshot, checks for concurrent edits, saves a backup in TEMP and rereads Started state. Credentials and callback configuration remain outside the repository.

OCI paths:

- Code: `/opt/energetica-whatsapp/dda-fiscal`
- Interpreter: `/opt/energetica-whatsapp/.venv/bin/python`
- Root-only config/progress/audit/results: `/var/lib/energetica-whatsapp/dda-fiscal`
- Existing oneshot service and timer: `energetica-dda-fiscal-reconcile.service` / `.timer`
- Verified existing schedule: 08:40, 13:40 and 18:40 America/Sao_Paulo; enabled state and cadence are preserved

For deployment stop the timer, allow the active service to finish, back up code/progress, install worker/tests as root mode600, run `restorecon -RF` on the code directory and run the service. Preserve the enabled timer and restart it after controlled backfill. Do not replace callback configuration or reset progress. The original match module is supplied for complete test reproducibility; its production matching rules were not modified.

The optional `controlled_backfill.py` uses the same reverse function and lock without repeating forward PDF checks. Run it as root only while the service is inactive and the timer is stopped; it preserves progress and writes a separate audit result.

Before backfill snapshot financial fields and attachment names/hashes on both lists. Afterward verify fiscal reverse copies match original DDA bytes, existing attachments are preserved and financial fields are unchanged. Replay using the same timer/service and verify no duplicate names or new writes. The app repository owns its own attachment-to-order/provision copying.


