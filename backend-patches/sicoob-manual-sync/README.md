# Manual Sicoob collection

The authenticated `/portal/chat` actions `sicoob_refresh` and
`sicoob_refresh_status` return `sicoobRefresh`, using the durable DDA request
protocol: lowercase 32-character hexadecimal request IDs, owner-bound status,
aliases for concurrent same-owner requests, pending receipts, and explicit
acknowledgement. Terminal manual receipts and aliases remain permanent
idempotency records. Repeating a completed ID never starts another collector.

`sicoob_worker.py` runs the existing statement importer, boleto receipt collector,
and Pix receiver collector without changing their financial logic or data
cutoffs. The manual daemon and scheduled service share `pipeline.lock` around
the entire pipeline. Manual heartbeats continue while waiting for that lock and
while subprocesses execute. Lock wait is bounded to 2,700 seconds, collection to
2,400 seconds, and queue age to 7,200 seconds. Process timeout kills the process
group before releasing the lock. The daemon runs as `energetica-whatsapp`.

The runner requires a complete JSON result and a successful exit from every
stage. It still attempts remaining stages after a stage fails, subject to the
overall timeout. Missing/malformed output, unexpected fields, transport errors,
rate limits, and reported write errors fail the receipt. Existing unresolved
boleto responses (200 with no verified match, 400, 404), ambiguous references,
and unmatched Pix identities remain unresolved optional details; they are not
reported as successfully enriched.

Receipt counts have these meanings:

- `created`: new statement records, verified through SharePoint readback.
- `updated`: verified boleto attachment/enrichment and Pix receiver writes;
  these may include enrichment of records created in this same collection.
- `verified`: statement debit records read back and compared, including existing
  records. This is not the number of confirmed receipts or counterparties.
- `pendingDetails`: unresolved boleto receipts plus eligible Pix receivers still
  awaiting confirmation. No banking payload, identity claim, or credential is
  included in the public receipt.

## Files and deployment

- `sicoob_sync.py`: private queue at `/var/lib/energetica-whatsapp/sicoob-sync`.
- `sicoob_worker.py`: fixed pipeline under
  `/opt/energetica-whatsapp/sicoob-manual-sync`.
- `energetica-sicoob-manual-sync.service`: persistent manual worker.
- `scheduled-pipeline.conf`: replaces scheduled `ExecStart` and clears the old
  `ExecStartPost` commands so stages run once within the shared lock.
- `deploy.py`: initial installation only; refuses modified bridge/collector
  hashes and existing new targets. Uses the global deployment lock, backups,
  atomic replacement, rollback, and both worker and channel-bridge health checks.
- `verify_live.py`: authorized direct-handler/queue verification. This is not an
  HTTP bearer-token end-to-end test. Reuses existing server access internally,
  prints no identity claims, and repeats a fixed saved verification ID safely.
  It refuses to guess identity mappings when there is more than one distinct
  existing owner or allowlisted email.

The access allowlist is copied from the existing DDA allowlist, with private
directory/file modes. Both installed and build-source bridge files receive the
new handler after `_portal_identity()` validation. The affected HTTP process is
`energetica-channel-bridge.service` on port 8765, whose `/health` returns JSON.
The separate worker service on port 8080 returns plain `ok`; deployment validates
both endpoints and restarts the channel bridge.

Before a future upgrade, inspect current live hashes and existing targets;
`deploy.py` intentionally refuses to overwrite a later installation blindly.

## Verification on 2026-11-11

- 22 new Linux tests passed, including authorization, durable aliases, retries,
  pending/acknowledge, failure receipts, optional unresolved-detail counts,
  subprocess heartbeats, actual process-group timeout, real flock contention,
  both service-health endpoints, a scheduled-service race during deployment, and
  timer restoration when installation and rollback health both fail, and
  rejection of ambiguous identities in the internal diagnostic. Heartbeat
  test covers 5,500 seconds, beyond
  the maximum combined lock wait and pipeline duration.
- 24 existing Sicoob tests passed both against repository code and copied live
  collector source. Original production collectors were not modified.
- Manual queue request `29b901bde93d4a06a0d2079a121c0894` completed at
  `2026-11-11T14:26:43.639910+00:00`: `succeeded`, created 2, updated 2,
  verified 4, pending details 19 (5 boleto, 14 Pix). All three stage receipts
  appeared in the manual service journal. The statement result requires a real
  bank query; the importer cannot produce this success from its schedule alone.
- Repeating that request before and after acknowledgement preserved the exact
  terminal receipt, completion time, and job count. No second collection started.
- Channel bridge restarted at `2026-11-11 14:28:36 GMT`, PID 3538180. Both
  8080 and 8765 health checks returned HTTP 200. An unauthenticated HTTP POST
  with `sicoob_refresh` returned 403 without an allowed origin and 401 with the
  valid application origin. The manual worker and scheduled timer were
  active; scheduled `ExecStartPost` was empty.
- Backup: `/var/backups/energetica-sicoob-manual-sync/20261111T142303Z`.

Installed SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| Both `channel_bridge.py` files | `53c4e52388b051dd5b6d8818c8be44499028c2fdc30402d393258032d9adc054` |
| `sicoob_sync.py` | `50e7ad419a9fbfdffdaeb1492697019e1971a5d0d429d92c96be7c5044adaf66` |
| `sicoob_worker.py` | `fed9c766ae48fc3fa96951fb581bf4ce4df2aa942cc5aff9af567e6dea91a344` |
