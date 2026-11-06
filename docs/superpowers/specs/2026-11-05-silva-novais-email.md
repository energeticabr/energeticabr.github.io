# Silva Novais: documentos mensais da Energética

Capture exclusively Asaas emails from Contabilidade Silva Novais for ENERGETICA CONSTRUCOES LTDA, CNPJ 38.626.750/0001-46. Use the Asaas charge identifier to join invoice and charge; select recurrence 28 by exact due date, supplier, branch, product and amount. Invoice competence/issue date can precede the payment month and must never select the target month by itself.

Preserve all financial fields, statuses, payment dates, links and existing attachments. Add missing original PDFs only, with SHA-256 verification and semantic invoice/charge deduplication. Mirror to an existing description using PROV provenance and the existing shared parent lock. Historical provisions without a description remain valid child-only destinations; do not create financial records or links.

Keep a durable dedicated SharePoint email queue, a protected OCI source cache and audit backups. The cache prevents Asaas boleto regeneration dates from creating a new PDF every day. Strict sender/recipient/CNPJ validation applies to the email and PDF. Follow only allowlisted HTTPS Asaas links with bounded redirects, bytes and timeouts.

Cloud recurrence searches daily at 06:50 Brasilia; OCI applies attachments at 07:10. Both run independently of Windows. Missing provisions wait; paid remote charges without a downloadable boleto remain explicitly partial while their original NFS-e is attached. Do not substitute a payment receipt for a boleto.

Historical records may already contain the invoice or lack a description link. The original boleto endpoint can return HTTP 500 for a paid charge while its NFS-e remains available. Keep this distinction explicit in the result. A charge without an exact existing provision waits and must never be attached to a neighboring month.
