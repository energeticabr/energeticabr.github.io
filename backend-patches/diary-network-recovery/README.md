# Diary recovery after a disconnected PDF request

Large camera photos were repeatedly resized and encoded from their full
24-megapixel resolution while the bridge held its conversation lock. A resume
request then queued at `portal_authorize`, exceeding the client's 30-second
timeout. Repeated resume clicks added more waiting requests.

The authenticated `diary_evidence_pending` action discovers only the current
Microsoft identity's authorized, running diary job. It bypasses the conversation
lock and returns telemetry only. The client polls it before sending a single
`input_continue`, showing the real photo/PDF progress while preserving the draft.
Cancellation and failed queries prevent that conversation request. Legacy 404
and the pre-feature bridge's exact HTTP 422 `Mensagem vazia` response fall back
to the normal resume path. Deploy the backend before the new clients.

Compression downsizes oriented images to a maximum of 1600 pixels before JPEG
quality retries, preserves aspect ratio, and closes temporary resized buffers.
The existing photo-byte budget, PDF validation and attachment commit remain in
charge of completion. Originals follow the existing successful-consolidation
cleanup path.

`patch_backend.py SOURCE TARGET` applies guarded, compile-checked replacements
to the already progress-enabled bridge and builder, and copies the registry.
It refuses changed or repeated anchors. Keep SOURCE read-only. Pin deployed
hashes, back up each target, install candidates atomically, restart the bridge,
check health, and independently read back installed hashes. Restore the backed-up
version if installation or health checks fail. No configuration edits are needed.

Tests: `python -m unittest discover -s backend-patches/diary-network-recovery -v`.
The compression fixture is a snapshot of the original production methods.
Set `DIARY_BUILDER_SOURCE` to a deployed builder candidate to check it directly;
set `DIARY_BRIDGE_SOURCE` to the bridge candidate to exercise its actual HTTP
handler, including authentication, other-account isolation, malformed input and
absence of calls to the locked conversation methods.

Verified deployment: 2026-11-03, live and build mirror, health HTTP 200 and matching
hashes after restart. A synthetic 4284x5712 photo on the production VM compressed
from 22,805,123 to 113,256 bytes in 5.91 seconds, retaining its portrait ratio.
