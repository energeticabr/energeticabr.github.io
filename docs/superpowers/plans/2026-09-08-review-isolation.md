# Isolated App Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit Apple review using a dedicated account with exclusively fictional data and no route to company databases.

**Architecture:** Existing native demo authentication and real workflow engine with per-session SQLite; independent Unix-socket service in a network-isolated systemd sandbox; native gate enabled only after deployment verification.

**Tech Stack:** Python, SQLite, systemd/Caddy, Capacitor/Vite, XCTest/GitHub Actions, App Store Connect.

## Global constraints

Only ENERGÉTICO. Never read company records or reuse corporate credentials for seeds. No production worker/config replacement. No secrets in source, output, bundle or screenshots. No fake success, hidden reviewers-only behavior or unverified publication claims. Preserve existing production routes. All demo uploads and records stay session-owned. No unrelated app feature work.

### Task 1: Complete real workflow demonstration coverage

**Files:** backend `demo/repository.py`, new `demo/seeds.py` if needed, `demo/runtime.py`, `demo/tests/`, `demo/docs/coverage.md`.

- [ ] Start from the existing 33-test baseline and record it.
- [ ] Add failing tests for missing builders and coherent reference selectors across the menu; use the pinned real engine only.
- [ ] Add minimal, explicitly synthetic reference fixtures with consistent relationships (no copied corporate rows). Keep transaction tests independent from optional showcase fixtures.
- [ ] Wire existing attendance, provision and diary builders with private output paths. Implement repository contracts only when required by real flows.
- [ ] Exercise representative advanced workflows with actual persistence/documents and task edit/delete; record unsupported paths precisely instead of fake success.
- [ ] Run focused tests then the full demo suite; report exact coverage and changed files. Backend is not Git: preserve baseline and report diff, do not initialize a repository.

### Task 2: Isolate and deploy the demo service

**Files:** backend `demo/__main__.py`, `demo/service.py`, new `demo/unix_server.py`, `demo/deploy/`, transport/security tests.

- [ ] Add failing Unix-socket transport tests, preserving existing loopback tests for local development.
- [ ] Implement Unix socket serving, safe socket lifecycle and client identity handling. Bound active sessions.
- [ ] Package only required modules and pinned definitions; provision a dedicated credential file outside source. Exclude production data, environment and secrets.
- [ ] Deploy root-owned code and a dedicated user with PrivateNetwork, AF_UNIX-only sockets, read-only filesystem and explicit production path denial. Limit temporary data, processes and memory.
- [ ] Verify the sandbox cannot read production files or connect to production/network services. Test real demo requests through Caddy, session isolation and production token rejection. Back up/validate Caddy before reload; never restart the production bridge.

### Task 3: Enable native review account and prepare submission

**Files:** native app config, native tests, release documentation, CI screenshot support only if required.

- [ ] Verify Task 1/2 gates and review changes before enabling demo access.
- [ ] Test native login/logout and no corporate fallback; build/upload the exact new iOS build.
- [ ] Capture accurate app screenshots for required iPhone/iPad sizes with fictional records, no review password visible.
- [ ] Enter dedicated review credentials and disclose isolation/reset behavior in App Review notes. Preserve saved contact/free price.
- [ ] Validate the exact build/privacy/metadata, submit if all prerequisites pass and verify Apple's resulting state. Report any external blocker accurately.

## Execution record

Worktree: `.worktrees/review-isolation`, branch `codex/review-isolation`, base 62c3d29. Windows has no bash on PATH; SDD ledger and briefs are created with apply_patch using the prescribed plan-scoped directory.
