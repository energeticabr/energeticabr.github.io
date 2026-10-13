# Report dismissal and daily RHID

- Every report overlay has exactly one visible close control showing the emoji `❌`, with an accessible close label.
- Remove duplicated visible close/home/back-to-menu controls when they close that report. Preserve printing, refreshing, filters, paging and in-report actions.
- Clicking the report's transparent outside area closes only that report; clicking inside does not. Preserve keyboard accessibility and cleanup, including loading/error states and portrait landscape rotation.
- The RHID calendar's lower `Gerar relatório` action opens only the daily attendance screen for the selected day, without generating/opening a PDF. Monthly generation remains on `GERAR RELATÓRIO MENSAL`; explicit sharing/export on a daily screen remains available.
- Preserve drafts, actual user sessions and the 14 protected signature blocks. Verify isolated browser fixtures, then publish applicable web/Windows, Android internal and iOS TestFlight changes as already authorized.

The attachment-recovery fix already in progress remains part of this release, with local-only rejected-ID dismissal, no stale transfer replay, same-session guards and bounded manual retry waits.

- Multi-item provisions group only by their real DESCRITIVOPROVISAO parent ID. A collapsed parent shows parent branch/supplier/due date, exact sum of linked visible children, products one per line and an accessible down arrow to expand the original child rows. Single-item rows and recurrence calculations remain unchanged.
- In the lower annual recurring table, totals are centered and semibold, dates are semibold and larger text must fit without splitting tokens. Existing zoom remains available.
- Description gallery STATUS is displayed, editable as a dropdown and filterable. Read actual SharePoint choices; if the schema is Text, use a complete read of actual parent/child statuses without modifying its schema. The initial filter is PAGAMENTO PREVISTO and excludes executed dates; explicit Todos/other statuses remain available.
- Physical portrait reports rotated to landscape retain at least 16px tappable backdrop on each safe edge, the same previous/next actions and logical landscape breakpoints. Rotation is presentation-only: preserve DOM, filters, pending requests and authentication, including keyboard resize.
- The payment report printer captures every loaded filtered launch without expanding the live DOM. Large report PDFs keep a bounded shared raster window while all pages remain reachable; release offscreen/in-flight backing stores, preserve the current employee through scroll/zoom/rotation and keep failed or unfinished pages unsigned. Page metadata/render failures affect only that slot, never restart or navigate the app.
