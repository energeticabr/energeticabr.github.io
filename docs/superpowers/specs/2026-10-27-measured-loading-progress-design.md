# Measured loading progress

The app currently creates percentage badges for every mascot loader but most callers never supply updates. Fix the producers and their ownership rather than animate an elapsed-time estimate.

Use bytes/items/pages when their total is available. Otherwise explicitly label a finite sequence of completed operation stages. A stage percentage measures completed stages, never elapsed time or VM CPU. Unknown byte totals fall back to operation stages without inventing a byte denominator. Keep the badge immediately right of the existing spinner.

Each foreground operation owns its progress and cancellation. Replaced searches, closed screens, old sessions and background thumbnail requests must not update a newer operation. Progress rendering/telemetry failure must not fail or repeat a business write. No new business mutations or access expansion.

The VM exposes a small bounded identity/request-scoped progress record. Polling is optional, authenticated, read-only, outside the conversation lock, at most one outstanding poll with a one-second interval. Record actual authorization, business completion, flow/attachment collection and response validation boundaries. Reuse the diary's finer measured progress where applicable. Mark 100 only after confirmed success; errors/cancellation do not complete.

For UI-only/data operations, a shared task helper counts preparation, acquisition and presentation/confirmation stages. Pass a scoped callback through compatible data requests; retain existing byte/page callbacks. Finish only after the UI accepts/renders the result. Scope subscriptions to the actual loader, never a process-wide current request.

Implement and validate in the existing owned linked worktree. Preserve all 14 protected signature blocks. Publish the same approved revision to Windows/web, Android internal and iOS TestFlight, and verify actual submission/deployment receipts plus VM health.
