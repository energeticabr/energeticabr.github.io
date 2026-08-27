# Power Apps Capabilities for 82 Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make every catalog mutation capability an auditable projection of literal Power Apps matrix evidence for all 82 SharePoint sources, with no proven mutation blocked and no unproven operation enabled.

**Architecture:** Break the circular dependency between the entity catalog and the Power Apps matrix by letting the matrix retain its own source-to-entity evidence and expose an immutable mutation-evidence query. The entity catalog consumes that query when building every entity, defaulting all mutations to denied when no evidence exists. Existing module authorization, live SharePoint ACL enforcement, and delete confirmation remain the independent execution gates.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, static SharePoint/Power Apps evidence manifest.

**Spec:** `docs/portal/powerapps-coverage-matrix.md`

## Global Constraints

- Base the isolated branch exactly on commit `ef0b589360d1a15d0fea5e95145b3ee469e71f26`.
- Do not access or modify Microsoft, SharePoint, Power Apps, or Power Automate live environments.
- Derive only `create`, `edit`, `delete`, and `approve` from literal matrix operation evidence.
- A missing or ambiguous evidence record must fail closed.
- Preserve module authorization and SharePoint ACL authorization before every repository mutation.
- Preserve explicit user confirmation before deletion.
- Include suppliers, ticket headers, ticket movements, and payment scheduling in regression coverage.
- Produce one isolated commit after fresh verification.

---

### Task 1: Evidence Contract for All 82 Sources

**Files:**
- Modify: `tests/powerapps-coverage-matrix.test.mjs`
- Modify: `portal/catalog/powerapps-matrix.js`

**Interfaces:**
- Produces: `mutationEvidenceForSource(source)` returning a frozen object with boolean `create`, `edit`, `delete`, and `approve` properties.
- Produces: matrix entity ownership derived from the literal `entityId` stored in each operation, without importing the final catalog.

- [x] **Step 1: Write failing tests for all 82 source contracts and representative sources**

Add assertions that all 82 exact SharePoint sources have one immutable evidence result, that the initial 93 capability divergences are detected, and that suppliers, ticket headers, ticket movements, and payment scheduling expose the literal observed mutations.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/powerapps-coverage-matrix.test.mjs`

Expected: FAIL because `mutationEvidenceForSource` does not exist and the catalog still has 93 divergences.

- [x] **Step 3: Decouple and expose immutable mutation evidence**

Remove the matrix dependency on `ENTITIES`; derive source ownership from operation `entityId` values already captured in the audited export. Reject inconsistent ownership and return all-false mutation evidence for unknown or ambiguous sources.

- [x] **Step 4: Run the focused matrix tests**

Run: `node --test tests/powerapps-coverage-matrix.test.mjs`

Expected: the evidence API tests pass; the catalog parity test remains RED until Task 2.

### Task 2: Fail-Closed Catalog Projection

**Files:**
- Modify: `portal/catalog/entities.js`
- Modify: `tests/portal-catalog.test.mjs`
- Modify: `tests/entity-pages.test.mjs`

**Interfaces:**
- Consumes: `mutationEvidenceForSource(source)`.
- Produces: every entity's mutation capabilities as the union of literal evidence for its exact `listNames`, with untracked entities denied.

- [x] **Step 1: Add failing full-catalog parity and authorization tests**

Assert zero blocked proven mutations and zero unproven enabled mutations across all 82 owners. Assert representative suppliers, tickets/movements, and payment scheduling capabilities. Assert a user lacking the module action remains denied and that deletion still requires confirmation.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/powerapps-coverage-matrix.test.mjs tests/portal-catalog.test.mjs tests/entity-pages.test.mjs`

Expected: FAIL with the existing 93 catalog divergences.

- [x] **Step 3: Derive catalog capabilities from evidence**

Replace hand-written mutation flags with the fail-closed evidence projection while preserving non-capability metadata and `view` availability. Do not infer approval from status fields, names, flows, or business semantics.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/powerapps-coverage-matrix.test.mjs tests/portal-catalog.test.mjs tests/entity-pages.test.mjs`

Expected: PASS with 182 literal create/edit/delete capabilities and no unproven approval capability.

### Task 3: Audit Documentation and Full Verification

**Files:**
- Modify: `docs/portal/powerapps-coverage-matrix.md`

**Interfaces:**
- Consumes: the evidence and catalog parity results from Tasks 1 and 2.
- Produces: documented derivation rules and representative audited examples.

- [x] **Step 1: Document the fail-closed derivation rule**

Record that source operations are the sole mutation authority, that aliases are unioned only within one catalog entity, and that `approve` remains disabled unless explicitly present as an operation action.

- [x] **Step 2: Run the complete suite and syntax checks**

Run all `tests/*.test.mjs`, the three legacy scripts, JavaScript syntax checks, and `git diff --check`.

- [x] **Step 3: Review the exact diff against the request**

Verify all 82 sources, the 93 initial divergences, representative entities, module/ACL guards, delete confirmation, no live side effects, and no unrelated files.

- [x] **Step 4: Create one isolated commit**

Commit the tested source, tests, and documentation on `fix/powerapps-capabilities-82-ef0b589` and report its hash.
