# SEFAZ CNO cluster implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Show a CNO cluster below each invoice supplier and above all other clusters.

**Architecture:** Read the fiscal observations and service description already loaded from SharePoint. Compare labeled, complete 12-digit CNOs with the work's established CNO 90.025.44060/72. Render the result in the existing SEFAZ card decorator and stylesheet without changing fiscal records, PDF actions, or signature code.

**Tech Stack:** JavaScript, CSS, Node tests, JSDOM, existing Vite/Chrome layout fixtures and release workflows.

**Spec:** User screenshot and messages in this conversation: correct CNO is green, absent CNO is red with "CNO não informada", conflicting CNO is red with "CNO errada", the found number and the work's correct number. A conflicting number takes priority even when the correct one also appears. Keep supplier wrapping and all existing galleries/links.

## Tasks

- [ ] Add failing model/card tests for exact identity, formatting, absence, conflicts, mixed CNOs and cluster position above withholding and invoice data.
- [ ] Implement a small fiscal CNO model and integrate the cluster into `sefaz-invoice-card.js` and `.css`.
- [ ] Add and inspect browser checks for all three states at 320/390px and Windows width, including PWA styles.
- [ ] Run focused tests, the app suite, builds, signature guard and independent code review; commit and merge the verified change.
- [ ] Verify public web assets, Android internal publication and iOS TestFlight processing/group availability for the merged revision.

## Progress

- Guard baseline: 14 signature blocks intact. Clean worktree from origin/main 28922b1d.
- Native worktree creation did not return; used Git worktree fallback in `app-cno`.
- No questions or additional approval needed: implementation and all three publication targets are already authorized.
