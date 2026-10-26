# Launch gallery local recalculation

The user wants search/filter recalculation confined to the launch gallery results, with search, filters and navigation remaining visible. Text input waits at least 3000 ms after the last input. The user delegates implementation decisions and publication without approval prompts.

Keep the existing initial/manual-refresh loading behavior. For automatic search/filter updates, retain the toolbar and native controls in place and interactive; mask only totals, count, cards and pagination. Do not replace controls or move focus/caret. Keep old results inaccessible while recalculating and publish only the latest matching response, including when another input is still debouncing. Select/checkbox/date changes apply immediately; text input/change/search events must not bypass the 3000 ms quiet period. Explicit form submission, clear and manual refresh remain deliberate immediate actions.

Approaches considered: changing every gallery's loader would broaden scope; adding a separate launch-only indicator would duplicate loading/accessibility logic. Reuse the existing loader with an optional clipped viewport and a second launch-results instance; unchanged callers retain their current behavior.

No backend, financial records, active drafts, attachment semantics or protected signature blocks are changed. Use fictitious data at 320, 390 and desktop widths, including slow/out-of-order/error responses, keyboard navigation, scrolling and resize. Publish the same reviewed revision to web/Windows, Android internal and iOS TestFlight and independently verify each target.
