# Automatic Tax-Withholding Provisions Design

## Goal

Whenever the authenticated fiscal collector persists an incoming authorized NF-e or NFS-e with a positive buyer-withholding amount, it must also persist one payment provision for that invoice and link it to the single withholding description for the due month.

## Business rules

- The due date is the 20th day of the month following the invoice issue month.
- All retained invoices with the same due month share one `DESCRITIVOPROVISAO` item.
- A different due month receives a different description item.
- The `PROVISÃO PGTOS` child stores only the required business data: `DATAPREVISTOPGTO`, `QTD=1`, `VALORTOTAL` equal to the buyer-withheld total, `OBS` equal to the supplier corporate name, `STATUS=PAGAMENTO PREVISTO`, and `FILIAL=004 - EDIFÍCIO XAVANTE`. Other ordinary child fields remain blank.
- The parent stores its due date, the sum of all linked retention children, the same status, and the same branch. Other ordinary parent fields remain blank.
- Technical idempotency uses the existing unique `FOLHAOPERACAO` columns: `RETENCAO-AAAA-MM` for the parent and `RETENCAO-NOTA-<CHAVE_ACESSO>` for the child. `Title` carries the same technical identifier and is not business data.
- Existing parent and child items are reused. Replaying the same fiscal document repairs a missing parent total but never creates a second child.

## Withholding boundary

- NF-e: sum positive `PIS_RETIDO`, `COFINS_RETIDA`, `CSLL_RETIDA`, `IRRF_RETIDO`, `INSS_RETIDO`, and `ISS_RETIDO`.
- NFS-e: sum positive `CONTRIB_SOCIAIS_RETIDAS`, `IRRF_RETIDO`, `INSS_RETIDO`, and `ISS_RETIDO`. `TOTAL_RETIDO` is a validation/declared-total field and is not added again, avoiding double counting.
- CT-e, outgoing documents, third-party documents, cancelled/substituted documents, summaries/events, and documents whose buyer-withholding total is zero do not create provisions.

## Integration and recovery

The provision actions run in the existing sequential fiscal-document loop only after the invoice and its PDF attachment are persisted. The fiscal batch is acknowledged only after the provision path succeeds. A failed write therefore causes the existing durable replay to retry.

The receiver resolves or creates the monthly parent by its unique technical key, resolves or creates the per-invoice child by its unique technical key, reads all children linked to the parent, recomputes the aggregate, and updates the parent. This ordering makes retries repairable after any partial failure.

Both the scheduled collector definition and the authenticated manual receiver are generated from the same action builder. The publication target is the live Power Automate receiver used by the Windows fiscal collector; Android, iOS, and Windows clients consume the same SharePoint rows without a client release.

