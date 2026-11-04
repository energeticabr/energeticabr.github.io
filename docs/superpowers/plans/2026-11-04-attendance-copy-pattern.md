# Copy attendance pattern implementation plan

**Goal:** Offer a modal after choosing an activity for an edited stage, copy the pair to selected attendance rows, and return to review.

**Architecture:** The server stores a short-lived offer bound to the selected source row and supplies eligible selected attendance records as structured metadata. The client renders an accessible two-step dialog and sends one opaque offer token and chosen record IDs. The server validates the token, selected IDs and catalog choices, applies an all-or-nothing draft update, then renders the summary. Existing final submission and supplier-default consent remain unchanged.

**Validation:** Focused in-memory workflow tests cover yes/no, forged or stale IDs, all-or-nothing failure, and no external writes before confirmation; browser tests cover both modal steps, small screens, and the return to summary. Run guard, full tests, builds and platform release checks.
