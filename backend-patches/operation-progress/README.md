# Progress from completed operations

Optional `progressRequestId` metadata is removed before the original chat/action validator. Authenticated `operation_progress` queries accept only action/requestId, return the requesting identity's bounded record and do not take the conversation lock or call business methods.

Chat counts five actual server stages: identity checked, business response returned, flow metadata collected, attachment snapshot collected, public response validated. Gallery actions have three actual stages: identity, business response and public response; they do not collect chat metadata. Existing diary photo/page progress refines only the business stage. This is completed-stage progress, not a VM CPU or elapsed-time estimate. Unknown totals never use safety limits as denominators.

The registry retains at most 256 jobs for 30 minutes without business content. Completion requires every stage of the selected plan plus processed/no-error confirmation. The client polls at one-second intervals with at most one read outstanding, ignores telemetry failures and waits for the real main response before completing its owned UI task.

Validate with `python -m unittest discover -s backend-patches/operation-progress -p 'test*.py'`. Optionally set `OPERATION_PROGRESS_BASE` to a private current bridge snapshot to exercise the actual handler AST with synthetic identity/data; never import or execute a real business module in a test.

Generate candidates with `patch_backend.py BASE CANDIDATE`; guard original/candidate checksums in the manifest. The installer reuses the reviewed non-clobbering atomic installer and both deployment locks, creates the new module without overwriting any file, backs up originals, restarts only the bridge and verifies health/hashes. On failure it restores only matching owned changes, preserving a concurrent writer. Run under the existing ingress/drain gate before apply. Deploy live and build mirror together. No workflows, records, attachments or credentials are modified.
