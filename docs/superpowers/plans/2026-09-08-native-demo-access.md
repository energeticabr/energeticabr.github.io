# Native Demonstration Access Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, as delegated by the coordinating agent. Do not spawn other workers or commit.

**Goal:** Add the authorized isolated App Review demonstration login to the native application.

**Architecture:** Extract native assembly into `src/demo/native-bootstrap.js`, using real existing controller/view/store/client dependencies. Implement memory-only session and isolated ports/recovery in `src/demo/demo-session.js`; keep corporate auth and native inbox implementation unchanged.

**Tech Stack:** JavaScript modules, Node test runner, jsdom, existing Capacitor native ports.

**Spec:** `docs/superpowers/specs/2026-09-08-native-demo-access-design.md`

## Global Constraints

- No production data, credentials or queued files in demo requests.
- No token persistence, MSAL fallback or cross-prefix media/redirects.
- Stop previous controller before every session switch.
- No commit, push or live API calls; coordinator handles deployment.

## Task 1: Session and transport isolation

- [x] Write behavioral tests for `createDemoSession({fetchImpl, now})`, covering `signIn({username,password})`, `getToken()`, `initialize()` and `signOut()`; assert emitted HTTP requests and expired/malformed response rejection.
- [x] Test existing `createChatClient({apiPrefix:'/api/demo'})` with actual sendText/sendFile/fetchMedia calls, asserting sandbox paths and rejecting corporate media.
- [x] Run `node --test tests/demo-access.test.mjs` and observe missing behavior before implementation.
- [x] Implement session validation, revocation, isolated `createDemoPorts(native)` and `createDemoRecovery()`; add `/api` versus `/api/demo` prefix validation to client preserving default.
- [x] Run focused tests until green.

## Task 2: Actual login and controller lifecycle

- [x] In jsdom mount `createNativeBootstrap({root, auth, native, config, fetchImpl})` using real controller and view. Click demo access, submit credentials, assert visible demo banner/chat and only sandbox requests. Exercise back/sign out and stale network response after cancellation.
- [x] Demonstrate red before implementation, then wire `start()`, `stop()` and `flushRecovery()` into `main.js`.
- [x] Add `allowDemo` and `demo` view options; bind demo choice outside corporate controller and render explicit credential form in bootstrap. Clear passwords on submission/cancel and clear session data on exit.
- [x] Add public privacy/support links to the signed-out view and demo form.
- [x] Run new tests plus existing auth, chat client, view, controller, recovery and package build tests. Report tested artifacts and any external gaps to coordinator.

## Verification result

Initial red: all six new tests failed due to missing demo modules and sandbox media rejection. Initial green: six passed. Additional late-upload test reproduced a session that redrew over corporate login after exit; a revision-gated view fixed this, giving seven demo tests green. The updated native-conversation harness executes both shipped bootstrap and main and preserves seven existing recovery/history regressions.

Final local checks: all 292 mobile tests passed, native Vite production build passed, root credential scan passed, and `git diff --check` reported no whitespace errors. No live sandbox, Apple build or iOS visual/open-link check was performed in this delegated task; coordinator handles these deployment checks. No commit or push performed.

Coordinator follow-up: independent review found external preview URLs and delayed token revocation. Two red regressions reproduced these and passed after stripping server-provided demo preview URLs and starting revocation before corporate startup. A further failing test reproduced the unready demo button being exposed; a default-off `demoAccessEnabled` gate now prevents that. Twenty-one focused demo/native/package tests passed after the gate and manifest changes. Backend remains separate, incomplete and undeployed; do not enable or submit as review-ready on this evidence alone.
