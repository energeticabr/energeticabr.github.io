# Finish active mobile publications

Repeated pushes to main cancelled the CNO iOS distribution before TestFlight, including its validated retry. Preserve the active main workflow and keep the newest pending revision, matching the existing Pages queue. Keep PR/feature supersession, current group names, all build/test/upload gates and the separate App Store review protections.

1. Add a regression matrix against the actual concurrency expressions and reproduce main cancellation.
2. Change only the two top-level cancellation conditions and explanatory comments; review/test the event matrix and existing Android bootstrap guards.
3. Integrate under the required signature guard and observe that the new main run queues while the current 2220/1885 runs remain active. Confirm CNO distribution from the active successor revision containing PR794.
