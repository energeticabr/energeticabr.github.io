# Selected filter chips implementation plan

**Goal:** Show committed dropdown selections as blue chips with an accessible remove button, including preselected values, without searching the options list.

**Architecture:** Extend the shared searchable-filter-selects picker used by fiscal proposals and reports. Show chips in the closed field and above the open list. Keep the native select as the value source and dispatch one native change when removing a selection. Single selects replace their value; existing multiselects retain their semantics and remove individual values.

**Constraints:** Preserve horizontal report orientation, keyboard search, safe area, disabled controls, form resets and signature gesture locks. The user authorized implementation and publication without additional confirmation.

## Task 1: Shared selector behavior and layout

- [ ] Add behavioral tests for preselection, replacement, removal, empty values, disabled state, resets and multiselect removal. Run to confirm missing-feature failures.
- [ ] Modify `apps/energetico-mobile/src/ui/searchable-filter-selects.js` and its CSS to render chips safely and clear the corresponding native selection.
- [ ] Run focused selector and NF-e tests, browser checks and web/native builds.
- [ ] Review the diff, commit, integrate through a PR and verify Pages, internal Android and TestFlight publication.

Review focus: option labels are plain text; disabled/readonly controls cannot be cleared; removal works with mobile blur/reflow; no placeholder becomes a chip; clearing does not auto-select the first product; dynamic options and external changes refresh chips.
