# DDA supplier-name fallback

Goal: When no parent total or individual unpaid provision matches the DDA amount, promote descriptions with similar supplier names and explain that the suggestion is based on the name.

Approach: Keep complete child reads and manual linking. Match meaningful name tokens after removing accents, punctuation, legal suffixes and generic business words. Recognize abbreviated names and joined/separated words. Give exact parent/child amounts priority over name-only candidates. Preserve due-date tie breaking and a single recommendation star; display a name-based explanation on fallback candidates without selecting any automatically.

- [x] Add failing tests for abbreviated supplier names, joined words, generic-only mismatches, multiple similar suppliers, amount priority and picker explanation without writes.
- [x] Implement token comparison, amount-first ordering and fallback explanation.
- [ ] Run focused/browser tests, builds, signature guard and full suite; review and integrate.
- [ ] Verify Windows public assets, Android internal publication and TestFlight availability for the final revision.

Execution: Reused the existing clean isolated worktree on a new branch from origin/main. Signature guard: 14 blocks intact. User authorizes implementation and publication without approval pauses.

Independent review found two issues: exact short brands lost matching, and generic sector words alone could recommend an unrelated supplier. Both reproduced with failing tests and corrected. Name matching now requires distinctive evidence; generic business words only refine an established match. Short brands (3M, HP, X), legal suffixes, joined words and abbreviated names are covered. Fourteen unit tests pass; final browser/build and complete-suite checks are in progress.
