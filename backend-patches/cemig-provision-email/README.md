# Utility invoices → exact monthly recurring provision pairs

The two production Outlook flows search once daily at 06:45 Brasilia time (`Day`, interval `1`, `E. South America Standard Time`). They have no email-arrival subscription or minute polling. The OCI timer processes the resulting queue once daily at 07:00 America/Sao_Paulo. Search Query filters by sender, subject token, attachments and the fixed 2026-11-04 cutover; read and unread messages are eligible. The fixed cutoff bridges the former subscriptions and avoids losing emails after an outage. Full exact sender/subject and configured property validation still runs before storing any new envelope. The connector quotes the complete search string itself, so subject tokens intentionally contain no nested quotes.

Each daily flow reads the technical queue's message IDs and expanded attachment filenames. A complete `mail.json` skips full email/PDF download; an existing row without that envelope is repaired in place. Other new messages are reread with original attachments, validated and stored as `mail.json` in the private `CEMIG FATURAS FILA` SharePoint list. State changes from RECEIVING to READY only after upload succeeds. Trigger and mail-loop execution are serialized; the flows fail explicitly on returned continuation tokens or result limits instead of silently truncating. Aged RECEIVING entries recover after ten minutes; incomplete envelopes retry during the next daily run. Financial updates and destination attachments remain restricted to the OCI daily schedule.

| Recurrence | Consumer unit | Property | Branch |
| --- | --- | --- | --- |
| 33 | 13.170.665.018-99 | Xavante, Antonio Torres dos Santos 130/134 | 004 - EDIFÍCIO XAVANTE |
| 4 | 10.033.217.018-90 | Alameda Oscar Niemeyer 1033, room 904 | 000 - ESCRITÓRIO CENTRAL |
| 14 | PETRANET customer 11721 | Antonio Torres dos Santos 134, Xavante | 004 - EDIFÍCIO XAVANTE |

Petranet uses a separate daily Outlook search with the exact sender `boleto@grupopetranet.com.br` and validated subject `Boleto da Petranet internet`. It reuses the same technical queue and the same daily worker; the legacy Cemig queue/unit names remain unchanged. `petranet.py` cross-checks the email's invoice number, due date, total and bank line with every original PDF, including its beneficiary, customer and Xavante address. The reference is read from the email and the due month selects recurrence 14's pair. Inline logos are ignored. A missing historical description waits; the worker never borrows a description from another month or creates financial records. Paid matching totals allow missing originals only. Original PDFs are deduplicated by content hash, and newer successful deliveries prevent stale invoice values from being reapplied independently for each provider/account.

Publish each daily flow with `Publish-CemigFlows.ps1 -Mode Publish -Provider cemig|petranet -QueueId <existing-queue-id>`. No maintenance ingress is created by default. Add `-CreateReplay` explicitly if one-time recovery is needed, then replay an exact email with `-Mode Replay -Provider cemig|petranet -MessageId <email-id>`. Delete the temporary replay flow after verification and remove its ignored local state key. Legacy event/replay state key names preserve the existing production flow IDs. The default provider remains Cemig.

The worker validates the email address and PDF unit against the same profile, then extracts the invoice reference, due date and Decimal amount. It selects exactly one existing child by recurrence, branch and original DATA payment month equal to the invoice due month. It follows only that child's actual `DESCRITIVOPROVISAO` link and requires the parent to contain only that child. No upload or value write is fanned out to the recurrence's other months. Missing monthly records become eligible after fifteen minutes and retry on the next daily run. Ambiguous or conflicting data goes to REVIEW without financial writes. Original PDF bytes, existing attachments, payment dates and payment status are preserved. A paid record with a different amount requires review.

Files are deduplicated by SHA-256 on both records, even when a previous upload has another filename. Original PDFs stay encrypted. The office PDF document prefix is fetched from the already registered supplier 11 at runtime and kept only in memory. Lookup timeouts remain retryable. The existing provision-parent lock coordinates with the attachment mirror. Financial writes use specific ETags, readback and conditional compensation on partial failure. A later completed delivery prevents an older email from reverting its invoice, with freshness isolated by consumer unit. Legacy results without a unit belong only to Xavante. Queue results retain the source email ID and outcome for audit.

The provision holds the original `CEMIG-...` or `PETRANET-...` file. Its description copy uses the standard mirror's `PROV-child-sha256-...` namespace, retaining child provenance. Giving that copy an unqualified parent-original name would activate the independent description-to-financial-record fanout and could duplicate the provision filename copier's output as a second `DESC-...` file downstream. The local uploads deliberately retain the shared parent lock and immediate exact-pair verification; invoking the normal inline upload hook under that same lock would reacquire it. Original content is never rewritten.

`test_attachment_provenance.py` runs the real parent fanout with the existing synthetic SharePoint fixture and an independent filename copy. It reproduces legacy 3-to-6 / 4-to-8 attachment counts and verifies the canonical utility copies remain one per source. Repository tests load the fixture from `provision-parent-fanout/tests/test_fanout.py`; OCI verification installs that unchanged fixture alongside the tests as `fanout_test_fixture.py`.

Run tests with `python -m unittest discover -s backend-patches/cemig-provision-email -p 'test_*.py'`.

Deployment installs `cemig_sync.py`, tests and flow builder under `/opt/energetica-whatsapp/cemig-provisions`, with the two supplied systemd units. Use the existing dedicated account/environment; state and locks belong to `energetica-whatsapp`. Run dry checks as that account, not root. `cemig_sync.py --dry-run` reads without modifying SharePoint. `--queue N` rechecks an exact queue record. Enable the timer only after the deployed tests and real dry-run pass.

`Publish-CemigFlows.ps1` uses existing authenticated Outlook/SharePoint connections. Setup is a one-time maintenance flow; it creates the queue and fields. Publish updates only the selected daily schedule unless temporary recovery was explicitly requested. Replay recovers an exact existing email ID without sending mail. Temporary setup/replay flows and their signed callbacks must be deleted after validation. Operational IDs are kept in the ignored local state file; no credentials or callback URLs are committed. Roll back by stopping the scheduled capture flow and, if needed, disabling the worker timer, retaining the queue and already confirmed attachments. Do not restore arrival subscriptions after the user's daily-only instruction.

This change updates server-side data consumed by the existing Android, iOS and Windows clients. It does not change mobile code or initiate payments.
## Silva Novais / Asaas

`silva_novais.py` attaches the original NFS-e and boleto of Energética (CNPJ
38.626.750/0001-46) to the exact provision from recurrence 28. It joins documents
by the Asaas charge ID and selects the provision by its full due date, supplier,
branch, product and amount. Invoice issue/competence month does not select the
payment month. Financial values, payment status/dates and links are never written.

`Publish-SilvaNovais.ps1 -Mode Setup` creates the dedicated durable SharePoint
queue; `-Mode Publish` installs the daily 06:50 Brasilia Outlook search. `-Mode Run`
performs an immediate capture through the daily trigger. The `energetica-silva-novais`
systemd timer processes the queue at 07:10 America/Sao_Paulo, without Windows.
Use `silva_novais.py --dry-run` to inspect targets/uploads, and `--seed <emails.json>`
only for an explicitly requested historical recovery. Source cache and before-write
backups remain under `/var/lib/energetica-whatsapp/silva-novais` with restricted
permissions. Never commit email envelopes, PDF files or signed download links.

Existing files are deduplicated by SHA-256 and fiscal/charge identity. Existing
description mirrors use the shared parent lock and `PROV-<child>-<sha256>-...`
provenance. A replay also completes a missing description copy of a boleto already
present on the child. Historical children without descriptions are handled without
creating new financial records. A paid charge is marked `BOLETO_INDISPONIVEL_QUITADO`
only after its actual PDF download fails; its available NFS-e is still attached.
The next daily run retries the unavailable original. A receipt is not relabeled
as a boleto. Missing exact provisions remain `WAITING`; ambiguous identities are
`REVIEW`; network/operational errors remain `RETRY`.
