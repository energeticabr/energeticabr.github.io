# Bounded unavailable-attachment recovery

Backend-only patch for `home_attachment_transfer`. The frontend consumes the
HTTP 422 metadata when the user chooses **Retomar conversa**, removing only the
rejected selected tray references. This package does not remove original files,
change the draft, or post documents.

`patch_bridge.py` performs exactly three guarded replacements: a dedicated
`ValueError` subclass, aggregation in the existing transfer validation, and
typed metadata in the existing `/portal/chat` error handler. Missing or duplicate
anchors, reapplication, and invalid Python syntax fail closed. Its CLI refuses
to overwrite the source or an existing candidate.

The two existing messages are preserved:

- A selected reference outside the eligible map: `Um anexo selecionado não está mais disponível ou já foi submetido.`
- Only missing/non-file/out-of-owner physical paths: `Um anexo selecionado não está mais disponível.`

Both return `code: "ATTACHMENT_UNAVAILABLE"` and `unavailableAttachmentIds`.
The array contains all rejected selected IDs in request order. Mixed cases keep
the first message's existing precedence. Valid selected references and
unselected references are omitted from the array. No names, raw paths or
unselected other-account IDs are exposed. Other exceptions keep their original
HTTP responses; matching error text alone never enables this metadata.

Authorization, selection/context validation, eligibility filters, pending
replays, confirmation, and success forwarding retain their existing behavior.
Aggregation finishes before event construction, messenger reset or an engine
action. No workflow state or attachment file is written during rejection.

## Reproduce RED and GREEN

Run in the shared worktree:

```powershell
$attachmentWorkspace = 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/energeticabr.github.io/.worktrees/orders-gallery-layout'
$attachmentPython = 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/provision-parent-multiple-20261008/.venv/Scripts/python.exe'
Set-Location -LiteralPath $attachmentWorkspace

# RED: actual unpatched production methods and real loopback HTTP responses.
$env:ATTACHMENT_RECOVERY_BASELINE = '1'
& $attachmentPython -B -m unittest discover -s backend-patches/attachment-resume-recovery/tests -p test_bridge_recovery.py -v

# GREEN: all bridge, guarded-patch and local-installer tests.
Remove-Item Env:ATTACHMENT_RECOVERY_BASELINE
& $attachmentPython -B -m unittest discover -s backend-patches/attachment-resume-recovery/tests -v
```

Observed RED before implementation: 24 tests, 8 assertion failures for absent
HTTP metadata, 16 existing-behavior tests passed, exit 1. Final GREEN: 45 tests,
all passed, exit 0. Patched source also compiled successfully in memory.

The pinned download remains read-only:

- Source: `artifacts/resume-attachment-20261013/channel_bridge.before.py`
- Source SHA-256: `50be0e6c259279a139a02ba58076502651246b1a21f1897471bf4683d921af95`
- Candidate SHA-256 for that exact source: `65609e7bc5a2d8aa4f7343ce188094960590e6fd91a538392fe7ed8251bc7685`

The fixture extracts the actual transfer, ownership, ID/context and HTTP code
via AST. Only external engine/token dependencies and success projections are
doubled. HTTP tests use a real local server and deserialize its real response.
They compare workflow/draft and all physical fixture files before and after
rejection, and prohibit engine writes/actions. Temporary files remain inside
this package's `tests/.tmp` and are automatically cleaned up.

Coverage includes unknown selections, multiple missing physical files,
submitted/read-only/hidden attachments, mixed rejection order, path ownership,
unselected files, valid ordered selection, malformed/duplicate/empty selections,
busy stages, state/context drift, idempotent pending transfers, confirmation
validation, Microsoft authorization, and unchanged unrelated HTTP errors.

## Prepared installer

`deploy.py` defaults to a read-only dry run. It requires separate live and
mirror SHA-256 pins, checks exact source paths, applies/compiles each candidate
before creating backups, and rechecks hashes before installation and immediately
before each atomic rename. Its only code targets are:

- `/opt/energetica-whatsapp/channel_bridge.py`
- `/home/opc/energetica-build/channel_bridge.py`

The optional `--apply` path creates verified recoverable backups, preserves
owner/group/mode, restarts `energetica-whatsapp` through `systemctl`, and requires
HTTP 200 from `http://127.0.0.1:8080/health`. Installation/restart/health failures
restore only this deployment's source changes, restart/check the restored
service, and save a receipt. Concurrent foreign edits are retained and an
incomplete rollback is reported with recoverable backups.

All four live/mirror root/worker `workflow_config.json` paths are checked for
content/presence changes and never written. No credentials or service-specific
connection configuration is handled.

Dry-run example on the intended Linux host, after obtaining both current hashes:

```sh
python3 deploy.py --expected-live-hash "$LIVE_SHA256" --expected-mirror-hash "$MIRROR_SHA256" --stage /home/opc/attachment-resume-recovery-stage
```

Installer tests use temporary local live/mirror copies with distinct baseline
hashes. They exercise default CLI dry run, compilation, CAS at multiple points,
backups, atomic installation, ownership/mode arguments, partial failures,
restart/health rollback, incomplete rollback, and configuration preservation.
`systemctl`, health checks and synthetic ownership changes are test doubles.

The main agent deployed this exact patch on 2026-10-13 after independent review,
45 passing local tests, fresh separate source hashes and a successful Linux dry
run. The service's Python 3.9.25 compiled both candidates; the guarded installer
saved verified backups, restarted the existing service and confirmed HTTP 200.
An independent read-back confirmed both candidate hashes, an active service and
unchanged workflow-configuration hashes. Frontend recovery was exercised with
isolated browser fixtures, without submitting real documents or altering the
user's signing draft.

Real failure/rollback injection was not performed against the live service.
CAS rejects a drifted source; capture fresh live and mirror hashes before any
future rollout and serialize source deployments. The two file replacements are
individually atomic; the backup/rollback path handles failures between them.
