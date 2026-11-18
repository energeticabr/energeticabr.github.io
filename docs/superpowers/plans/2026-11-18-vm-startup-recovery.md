# VM startup recovery

Goal: shorten fresh menu construction and prevent premature recovery timeouts.

Evidence: production portal request at 13:54:14 UTC took 28,111 ms; recovery aborts at 15 seconds. Menu construction serializes independent queries and repeats diary and provision reads.

- [ ] Add regression tests for overlapping independent reads, one diary/provision read, unchanged menu content, NB isolation, query failures, and fresh results on each call.
- [ ] Replace only `_start_group_menu_options` in hash-pinned live/build workflow baselines, using three workers for independent reads. Reconcile diary state once on the calling thread. Preserve all existing menu IDs, counts, red indicators and shortcuts.
- [ ] Test and fix recovery so real operation progress extends inactivity deadlines, repeated progress does not, and the first request has a 30-second budget. Keep bounded overall waiting, cancellation and drafts.
- [ ] Run focused suites/builds and signature guard. Benchmark real menu reads, deploy through the existing guarded installer and verify health. Publish and verify web, Android internal and TestFlight.
