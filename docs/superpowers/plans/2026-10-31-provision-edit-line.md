# Multiple provision review: choose a line before a field

User request: when editing multiple payment provisions, ask which line before asking which field. Apply the change only to that selected line.

Root cause: payment review falls through `_prompt_edit_field`; only launch batches currently select a row first. `_provision_after_fields` replaces the last provision snapshot unconditionally.

Approach: extend the existing provision flow with an explicit line-choice state, restore the chosen snapshot for field editing, and write it back by its saved index. Reuse ordinary field controls. Keep the original collection cursor and whole-batch discount/freight/reference handling consistent.

Constraints: no persisted financial record edits or tenant writes during QA; only the live common backend needs publication for Android, iOS and Windows. Preserve attachments, single provisions, settlement/descritivo editors, navigation, resumed drafts, and started submission locks. Full runtime source remains private.

1. Add real-engine synthetic regressions and observe failures on the deployed baseline.
2. Implement the minimal line-choice and selected-row update; verify filtering, resume, back, repeated edits, sign-aware discounts, freight and untouched neighboring lines.
3. Review the complete minimal patch independently; validate installer contracts and exact source pins.
4. Merge green CI, deploy with gate/drain/backup/health/rollback, verify installed-source synthetic tests and published app opening.
