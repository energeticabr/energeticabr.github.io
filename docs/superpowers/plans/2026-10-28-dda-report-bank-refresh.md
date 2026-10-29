# Report bank refresh

Use the account-owned durable DDA sync monitor for the report refresh button, just as for the gallery. Keep the report open, disable repeat requests, show progress, reload SharePoint on completion, and retain filters. The existing global receipt owns completion/acknowledgement across navigation and restarts. Defer reload while a manual payment confirmation is open. Closing the report must not stop the bank request.

Validation: controller wiring, request deduplication, terminal refresh, failures, close/reopen and payment overlap tests; browser report regression, signature guard and PWA build. Review, merge and publish web, Android internal and TestFlight using existing workflows.
