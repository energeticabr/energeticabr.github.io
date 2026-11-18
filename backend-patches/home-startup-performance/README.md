# Initial menu performance

Production request at 2026-11-18 13:54:14 UTC took 28,111 ms; the app abandoned each resume request after 15 seconds and retried. The menu repeated diary and provision queries and serialized independent SharePoint reads.

`menu_method.py` replaces only `_start_group_menu_options`. Diary reconciliation runs once on the calling thread; six independent read tasks use at most three workers, with isolated copies of the configured HTTP session and field caches. Provision totals and overdue highlighting share one source read; diary counts and shortcuts share one result. NB exits before Energético reads. No cache persists across requests.

Read-only benchmark against actual SharePoint sources: original 2.610 s, candidate 0.730 s, all 11 menu options exactly equal. This measures menu construction, not complete app startup or peak-load latency.

The installer checks exact production and independent build-mirror pins, compiles the patched source, drains ingress, backs up, atomically replaces only the live workflow, restarts and verifies health. The build mirror remains guarded because it has an independent baseline. Existing restore/conflict tests are included. Run `python -m unittest discover -s backend-patches/home-startup-performance -v`; Linux covers the gate, lock and permission cases too.

The mobile change gives the first resume request 30 seconds and recognizes advancing normalized operation progress; repeated polling and prepared animations do not reset inactivity. Draft reconciliation, cancellation, finite inactivity and business-write retry rules remain in place.
