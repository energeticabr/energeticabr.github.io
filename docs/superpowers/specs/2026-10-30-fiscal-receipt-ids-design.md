# Fiscal receipt row IDs

Display every confirmed newly created SharePoint row ID inside the left edge of its NF-e, CT-e or NFS-e result cluster. Keep the source and status/count text to the right. Use compact `#123` badges with readable wrapping and no horizontal page overflow. Preserve the acknowledgement workflow and processed-document semantics.

Extend each fiscal receipt source with optional `createdItemIds`, a deduplicated array of positive safe integer SharePoint item IDs. The worker must obtain them from confirmed created-row deliveries; existing/updated rows, document counts, fiscal access keys and unconfirmed deliveries are not new-row IDs. Preserve metadata across polling and restart. Legacy receipts without IDs remain readable and show an unavailable placeholder; an explicitly empty list means no additions. Do not rerun fiscal queries or write real financial records for QA.

Validate with fictitious receipts at 320/390 px and desktop. Review and publish to PC/web, Android internal and iOS TestFlight, together with the required collector/VM receipt update.
