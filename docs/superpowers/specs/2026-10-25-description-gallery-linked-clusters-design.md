# Description Gallery Linked Clusters

The user requests a larger ID cluster on the left of each description-gallery
card and a large selectable cluster opening every provision linked to that
description. The existing edit, attachment, financial and audit fields remain.

Use the existing registration card rather than a replacement gallery. Display
the ID in a red, at-least-64px badge before the supplier heading, and a full-width
blue button labelled Provisões vinculadas / Ver detalhamento. Reuse the existing
read-only description detail and exact-link all-page reader. Expose that reader
only for the description registration kind. Share the payment formatting helpers
so both entry points render identical financial totals and dates.

Approaches considered: a separate child gallery would duplicate fetching and
modal behavior; an expanded inline list would crowd mobile cards. Reusing the
published modal is the implementation choice, consistent with the requested
behavior. The user explicitly delegated implementation choices and opted out of
approval questions.

Preserve filters, sort, page and focus on close. Refresh/close/destroy cancels the
detail. Asynchronous attachment-count redraws must not strand focus on a removed
trigger. Errors and timeouts retain close/retry. Include paid, off-page and
off-filter children, reject partial pages and invalid IDs, render source as text.
No financial writes, relationship edits, new dependencies or schema changes.
Keep all14 signature-protected blocks intact. Verify320/390px and desktop, then
publish the same revision to web/Windows, Play internal and TestFlight only.
