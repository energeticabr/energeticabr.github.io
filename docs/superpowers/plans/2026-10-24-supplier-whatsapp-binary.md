# Supplier WhatsApp Binary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask whether a supplier phone has WhatsApp using direct SIM/NÃO answers.

**Architecture:** Patch only the existing conditional supplier step and extend
the scoped legacy-option refresh. Retain separate live/mirror implementations
and use the existing four-target compare-and-swap deployment pattern.

**Tech Stack:** Python workflow engine, JSON configuration, shared channel bridge.

**Spec:** `docs/superpowers/specs/2026-10-24-supplier-whatsapp-binary-design.md`

## Global Constraints

- Blank phone: 1=NÃO, 2=SIM. Filled phone: 1=SIM, 2=NÃO.
- Preserve homologação, unrelated recommendations, parent context and data.
- No protected signature changes, native binaries or web bundle changes.
- Deployment requires reviewed hashes, locks, backups and health verification.

## Review Focus

- Blank/missing phone must not invert legacy IDs.
- Old keep/expand buttons must not write an unintended answer.
- Typed text must not silently advance the existing explicit-selection protocol.
- Existing homologação direct choices and other recommendation menus must survive.
- Drift, duplicate targets and unreviewed candidate paths must fail closed.

### Task 1: Direct WhatsApp selection and verified publication

**Files:** Create `backend-patches/supplier-whatsapp-binary/{test_whatsapp.py,patch_backend.py,test_patch_guards.py,deploy.py,deploy-manifest.json}`.

**Interfaces:** Consume independently captured live workflow/config sources.
Produce `patch_config(config)`, `patch_workflow(source)`, `generate(source, output)`
and a four-target manifest consumed by `deploy(stage, apply=False)`.

- [ ] Write real-engine/bridge tests covering direct labels/no filter, both IDs,
  typed-text safety, resume, old expand, old keep and parent preservation.
- [ ] Run on the unmodified capture; observe the collapsed menu failure.
- [ ] Remove the step-specific recommendation configuration, preserve legacy
  IDs and extend only the existing scoped refresh to the WhatsApp key.
- [ ] Run WhatsApp and homologação behavior tests on both candidates, patch
  guards, signature guard and the repository test command; record limitations.
- [ ] Request one independent whole-branch review and address important findings.
- [ ] Commit, push and merge the reviewed patch under the standing authorization.
- [ ] Check and apply the four-target guarded deployment; independently verify
  hashes, services, public health and behavior against both installed variants.
