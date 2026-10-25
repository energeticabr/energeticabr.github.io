# Edit a provision's description link

## Intent and scope

The payment provision editor must expose **Descritivo da provisão** so a user
can move an existing provision to another existing DESCRITIVOPROVISAO record.
Do not change supplier, branch, payroll identity, attachments, payment dates or
create another provision/description as a side effect of changing this link.

## Approach

Reuse the existing searchable select and metadata-driven gallery editor rather
than accepting an unchecked free-text ID or introducing another editing screen.
Load all bounded pages of description options, label them by ID and identifying
supplier/observation, and show the currently stored selection. A loaded link may
not be cleared; an originally unlinked provision can retain its blank value.
This is the implementation choice, not an additional user requirement.

Keep the existing text-backed SharePoint ID representation. Validate the target
again at save time and use authoritative ETags. Recalculate both parent totals
from their actual complete child sets, including quantity and freight. If the
last child is moved, the previous parent's total becomes zero; never delete it.
Existing amount/date-only edits keep their behavior. A failed synchronization
must not show success; retry in the retained editor reconciles confirmed writes
without moving/duplicating the provision a second time.

## Verification and delivery

Use fictitious records for write tests and narrow-screen visual checks. Do not
relink an actual financial record merely to test the UI. Verify the published
editor without submitting a real change. Run the signature guard, focused and
full app suites, builds, independent review and CI. Publish the same verified
revision to the Windows/web app, TestFlight and Google Play internal testing.

No changes to protected signature gesture blocks, SharePoint schema, automatic
tax rules or unrelated flows. The user explicitly opts out of approval pauses.
