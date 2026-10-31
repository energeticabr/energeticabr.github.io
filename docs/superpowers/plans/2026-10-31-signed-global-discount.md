# Signed Global Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Accept a negative global discount as a surcharge in provisions and launches.

**Architecture:** A scoped signed BRL parser feeds the existing provision factor and launch allocation paths. Existing positive-only parsers remain unchanged by default; summaries display the actual adjustment type. Publish only the changed common backend files.

**Tech Stack:** Python Decimal, real WorkflowEngine with synthetic fixtures, pinned VM rollout.

**Spec:** docs/superpowers/specs/2026-10-31-signed-global-discount.md

## Global Constraints
- At most two decimal places for provisions and all negative adjustments; preserve legacy positive launch fractions and currency formats. All values finite; negative only for global adjustment.
- Preserve quantities, freight, attachments, parent/order linkage, frozen journals and idempotency.
- No tenant financial writes during testing; private full source stays outside public git.
- Protect all 14 signature blocks; publish common backend for Android, iOS, Windows.

## Review Focus
- Brazilian negative strings and restored numeric metadata retain their sign.
- Editing/removing/changing sign does not compound adjustments.
- Totals including freight agree after numeric persistence for fractional quantities.
- Negative quantities/prices/freight and malformed discounts remain rejected.
- Existing draft resumes and retries preserve confirmations and frozen payloads.

## Tasks
- [ ] Main: add failing provision tests, implement scoped parser and signed provision calculation/summary/prompt in private candidate; verify regressions.
- [ ] Launch worker: add failing launch tests and implement signed launch handling, allocation, prompts and descriptions in private workflow/config only; verify positive regressions.
- [ ] Main: integrate, publish minimal source.patch and tests, prepare pinned rollout and review.
- [ ] Independent reviewer: review whole diff, numeric precision, retries and deployment scope.
- [ ] Main: deploy reviewed hashes to common server, verify source/health and synthetic end state; open app and record delivery.

## Fix round 1
- Four P2 findings accepted: low-context launch precision, legacy positive formats, numeric parent transport preflight, and installer candidate TOCTOU.
- Main fixes shared parser compatibility and provision parent transport; launch worker owns precision and legacy positive caller compatibility; deployment worker owns install from validated bytes.
- Existing raw first-freight tests have identical 4 failures/1 error on baseline and candidate; use their already-adapted 47-test provision-global-discount regression suite for the current workflow.
