# Provision review phone layout plan

**Goal:** Read product, quantity, unit price and total without horizontal dragging in provision settlement details.

**Design:** At phone widths, each semantic table row becomes a wrapping item: product across the row, followed by labeled numeric fields. Short fields share the available width; long values wrap onto another field row without shrinking the font or truncating numbers. Checkbox stays beside the product. Desktop keeps its table. The same markup serves selectable and read-only reviews.

**Constraints:** Preserve selection, totals, pending/paid statuses, freight, edit/submit behavior, literal escaping and signature gesture locks. Synthetic test data only. No financial writes.

- [ ] Add browser regression requiring every numeric field and total to fit without horizontal scrolling at 320px and 390px, for both review modes and long/pending values.
- [ ] Add scoped mobile layout and field labels; preserve desktop table and accessibility semantics.
- [ ] Verify focused behavior, visual captures, full validation and independent review.
- [ ] Publish web, internal Android and TestFlight; verify each result independently.
