# Task 2 local synthetic verification

Date: 2026-10-24. Original task BASE:
`f5737c869da9518ef6520653f02dfc845eeb1949`.
The parent independently committed the HR menu assertion update as
`ae7f111499f2dfe7eb8d6e7c5e616ede3e22a6c0`. This package does not include it.

The original 77 scenarios pass independently for app and mirror: 77 passed,
6 additional installer cases deselected, 6 unittest subtests passed per variant.
The final complete suite passes for both actual candidate workflows:

| Variant | Result |
| --- | --- |
| App | 162 passed, 30 subtests passed, 56.92 seconds |
| Mirror/build | 162 passed, 30 subtests passed, 53.41 seconds |

There are no final failures, skips or xfails. The 162 consist of the reused 77,
six additional deploy cases, 24 role/link prompt paths, 29 real-engine HTTP
integration cases, 14 current binary-menu regressions and 12 packaging/adaptation
guards. Both current binary regression copies differ from their source only in
the fixture's supplier employment version (1 to 2).

RED against the independent fresh captures: 43 failed and 2 passed per variant.
These include skipped role/admission prompts, non-durable uncertain source
creation, duplicate/lookup behavior, missing positive-authority helpers and the
missing guarded installer. Later RED tests caught malformed restored admission
strings before source POST and three packaging guards: staging under live roots,
omitted explicit absence pins and output aliases. Each is green in the final run.
Private logs also preserve intermediate test-fixture corrections and Windows
MAX_PATH failures; the runner uses extended paths to keep all final temporary
state and media under the authorized private output.

Both workflow variants retain every existing method except the seven specified
feature integration points, and gain exactly two methods. AST comparisons check
that boundary. Config guards preserve both binary menus and all other flows;
behavioral tests cover cached menus and the actual portal serializer.

The integration tests use the captured real WorkflowEngine and SharePointClient,
LocalStateStore and LocalMediaRepository. Only external HTTP and records are
synthetic. They cover all 24 role/link combinations, 27-field readback, source and
target uncertain POST/restart, fixed answers, missing/reordered/multiple uploads,
original local bytes, later RH edits and no source-attachment fallback/import.

The installer scenarios use private synthetic roots and fake service operations.
They exercise eight-target validation, independent drift, absent/create-only
helpers, compilation before writes, real Windows junction rejection, helper
publication races, concurrent-workflow preservation and CAS rollback. Both
shared lock paths are asserted; production POSIX lock acquisition, systemd and
health endpoints are intentionally left to the parent's actual rollout.

Reproduction commands and complete RED/GREEN log locations are recorded in the
private Task 2 report. See README.md for the runner and builder CLI. Python test
dependencies were installed only into the designated private dependency folder;
pytest 9.1.1, requests 2.34.2 and tzdata 2026.5 were verified locally.

Reviewed manifest SHA-256:
`0d7de8493a05cb06ac78316dbe412ecbbca6922f645d8be4d31ff224df8d6db7`.
Sanitized source.patch SHA-256:
`c377414e9e91d05d173a2958c327dbf12836a52301e3530e903f1b0ac84574ba`.
Installer SHA-256:
`d615e1a8ae8357e55fe21e333c011292aa86e0326f935e63a0acb9b144041b54`.

Rollback ruling: retain new helpers inactive after restoring old workflows;
record exact paths and hashes instead of attempting a non-atomic CAS unlink.
Concurrent changes are preserved and incomplete recovery is explicitly reported.
No worker production access, schema/ACL changes, SSH, deploy, bootstrap, push,
merge, native build or publication occurred. The parent owns those gates and
the full Node suite. Author self-review is complete; independent review remains
with the parent before deployment.
