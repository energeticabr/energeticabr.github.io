# Pending provision location summary

The user wants the home due-payment report to show the supplier above the due date, and a permanently visible FILIAL field inside the light-blue summary with the value `branch (property)`. The disclosure arrow is selectable only when at least one confirmed attachment exists; it no longer reveals branch/property. The user delegates implementation and publication decisions without approval prompts.

Reuse the current report renderer and controller, rather than creating a second report or changing the backend. Keep due-date colors/values, grouped IDs/counts, product, edit, settlement, delete, print and attachment open/share unchanged. Place supplier once across the colored header's two columns. Place one FILIAL field in the blue summary, with property in parentheses when present; missing branch is shown as — and missing property does not create empty parentheses. Remove separate concealed branch/property rows.

Only `available` attachment state with a nonempty named attachment list enables expansion. Loading, empty, error, malformed lists and missing IDs cannot expand, including direct controller events or stale expanded IDs. Keep attachment discovery automatic. On a failed attachment lookup provide a separate read-only retry button, not a selectable arrow. Keep labels/values escaped and usable on 320px/390px and desktop, and keep report printing informative.

No financial records or active user drafts are changed. Do not alter protected signature blocks. Publish the reviewed/tested revision to Windows/web, Android internal and iOS TestFlight; verify actual uploads and beta association independently. Never dispatch a competing workflow on refs/heads/main while an authorized publication is running.
