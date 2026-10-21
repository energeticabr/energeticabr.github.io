# Weekly meal provisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the Sunday grouped VALE ALIMENTAÇÃO provision flow with a detailed PDF and safe retries.

**Architecture:** A deterministic Python builder produces an importable native Power Automate definition using standard SharePoint and OneDrive connectors. Unique existing keys and a frozen private manifest support recovery. Non-Sunday manual runs are previews only.

**Tech Stack:** Python unittest, Power Automate WDL, SharePoint REST, OneDrive PDF conversion.

**Spec:** docs/superpowers/specs/2026-10-21-weekly-meal-provisions-design.md

## Global Constraints

- Sunday 06:00 America/Sao_Paulo; next Friday due date.
- Exactly one parent per week; one child per active SIM supplier with CARGO.
- Product/OBS VALE ALIMENTAÇÃO; quantity 5, unit price 45, total 225 each.
- Child FILIAL from FORNECEDORES; IMOVEL TODOS; FORMAPGTO blank.
- No LANCAMENTOS/orders/settlement or new schema permissions.
- Test previews must not create financial records; no initial out-of-schedule load.

## Review Focus

- A transport failure after a committed POST must not duplicate records.
- A roster change between attempts must not silently change the weekly batch.
- Child VALORTOTAL stores unit price, not extended total.
- A multi-branch roster must keep the supplier's branch on each child.
- A failed conversion or incomplete supplier page must prevent financial writes.

### Task 1: Build and verify the native weekly flow

**Files:**
- Create: automations/weekly-meal-provisions/build_flow.py
- Create: automations/weekly-meal-provisions/test_build_flow.py
- Create: automations/weekly-meal-provisions/README.md

**Interfaces:**
- Consumes: existing list GUIDs, writable field types and unique keys verified by read-only audit.
- Produces: plan_week(suppliers, reference_date), build_definition(), build_package(output_dir).

- [ ] Write failing tests for date/eligibility/grouped payload/keys/standard connector/preview and manifest contracts.
- [ ] Run `python -m unittest discover -s automations/weekly-meal-provisions -v`; expected missing implementation failures.
- [ ] Implement the deterministic builder, immutable manifest recovery and read-after-write verification.
- [ ] Run the full automation suite; expected all passing.
- [ ] Commit the source, tests, spec and plan.

### Task 2: Publish and validate Power Automate

**Files:**
- Create: docs/verification/weekly-meal-provisions-20261021.md

**Interfaces:**
- Consumes: Task 1's package; existing Microsoft account SharePoint/OneDrive connections.
- Produces: actual cloud flow ID, enabled Sunday recurrence and verified preview PDF.

- [ ] Import using the visible authenticated Power Automate UI and map existing connections.
- [ ] Execute a non-Sunday preview and inspect the complete PDF, seven rows and R$ 1.575,00 total.
- [ ] Check parent/child list counts remain unchanged by preview.
- [ ] Obtain one fresh final review, fix important findings with RED/GREEN coverage, then verify flow enabled and next Sunday recurrence.
- [ ] Commit deployment evidence, push/PR/merge; app binaries need no rebuild because no client code changes.
