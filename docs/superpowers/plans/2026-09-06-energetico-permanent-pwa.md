# Energético Permanent PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Follow test-driven development for every behavior change.

**Goal:** Publicar o chatbot Energético como PWA permanente e criar um canal seguro para o Atalho do iOS encaminhar fotos e arquivos sem assinatura Apple.

**Architecture:** O build Web reutiliza as camadas transacionais do app Capacitor e injeta autenticação e seletores do navegador. A VM emite tokens opacos, armazena somente seus hashes e aceita esses tokens apenas numa rota de upload do Atalho. GitHub Pages publica a PWA no subdiretório `/energetico/`.

**Tech Stack:** JavaScript ES modules, Node 24 test runner, Vite 8, MSAL Browser 5, Web App Manifest, service worker, Python 3 unittest, `ThreadingHTTPServer`, Caddy e GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-06-energetico-permanent-pwa-design.md`

### Task 1: Browser adapters and PWA shell

**Files:**
- Create: `apps/energetico-mobile/src/web/browser-auth.js`
- Create: `apps/energetico-mobile/src/web/browser-ports.js`
- Create: `apps/energetico-mobile/src/web/main.js`
- Create: `apps/energetico-mobile/pwa/index.html`
- Create: `apps/energetico-mobile/pwa/manifest.webmanifest`
- Create: `apps/energetico-mobile/pwa/service-worker.js`
- Create: `apps/energetico-mobile/vite.pwa.config.js`
- Create: `apps/energetico-mobile/tests/browser-auth.test.mjs`
- Create: `apps/energetico-mobile/tests/browser-ports.test.mjs`
- Create: `apps/energetico-mobile/tests/pwa-shell.test.mjs`
- Modify: `apps/energetico-mobile/package.json`

1. Write tests for redirect login, silent token retrieval, cancellation-safe camera/files, Web Share fallback, manifest scope, standalone metadata and API cache exclusion.
2. Run each focused test and confirm it fails because the Web adapter or shell is absent.
3. Implement the minimal adapters and shell, using `/energetico/` as the exact base and the existing chat controller/view.
4. Run focused tests, all mobile tests and `pnpm run build:pwa`.

### Task 2: Installation and Shortcut enrollment UI

**Files:**
- Create: `apps/energetico-mobile/src/web/shortcut-client.js`
- Create: `apps/energetico-mobile/src/web/install-view.js`
- Create: `apps/energetico-mobile/tests/shortcut-client.test.mjs`
- Create: `apps/energetico-mobile/tests/install-view.test.mjs`
- Modify: `apps/energetico-mobile/src/web/main.js`
- Modify: `apps/energetico-mobile/src/styles.css`

1. Write tests proving that installation guidance appears only outside standalone mode, token issue/revoke calls require Microsoft bearer authentication, the secret is shown only from the current response and the instructions contain no secret in a URL.
2. Confirm the tests fail for the missing modules.
3. Implement a compact setup panel with `Instalar no iPhone`, `Configurar compartilhamento`, token copy, `shortcuts://create-shortcut`, revoke/regenerate and an upload test guide.
4. Run focused and complete Web tests.

### Task 3: Scoped persistent token store in the VM

**Files:**
- Modify: `../whatsapp-sharepoint-oci/channel_bridge.py`
- Modify: `../whatsapp-sharepoint-oci/tests/test_channel_bridge.py`

1. Write Python tests for issue, persistence, hash-only storage, single-active-token rotation, revoke, invalid/malformed store and thread-safe atomic writes.
2. Run the focused unittest cases and confirm the expected missing-class failures.
3. Implement `PortalShortcutTokenStore` with `secrets.token_urlsafe(32)`, SHA-256, `hmac.compare_digest`, atomic replace and owner-only POSIX permissions.
4. Run focused and complete backend suites.

### Task 4: Enrollment and Shortcut upload endpoints

**Files:**
- Modify: `../whatsapp-sharepoint-oci/channel_bridge.py`
- Modify: `../whatsapp-sharepoint-oci/tests/test_channel_bridge.py`

1. Write HTTP tests for Microsoft-authenticated issue/revoke, exact CORS origins, missing/invalid shortcut token, successful binary forwarding to `portal:{oid}`, filename normalization, size limits and transactional failures.
2. Run the HTTP tests and confirm their routes return the expected red state.
3. Add `/portal/shortcut-token` and `/shortcut/upload`, sharing the existing staging/processing path without granting chat or media scope.
4. Run focused and complete backend suites.

### Task 5: Deployment and Pages publication

**Files:**
- Modify: `.github/workflows/pages.yml`
- Modify: `../whatsapp-sharepoint-oci/deploy/vm/deploy-approved-portal-chat.sh`
- Modify: `../whatsapp-sharepoint-oci/README.md`
- Create: `apps/energetico-mobile/INSTALL-IOS.md`

1. Write executable package/deployment tests covering a deterministic PWA build and both new Caddy routes.
2. Confirm red state, then update the workflow to install/build the PWA and copy `dist-pwa` to `_site/energetico`.
3. Update the backup-first VM deploy script, documentation and iPhone guide without embedding tokens.
4. Run the complete local portal, mobile and backend gates.
5. Deploy the VM transactionally and verify health, CORS, unauthorized responses and service status.
6. Add `https://www.energeticabr.com/energetico/` as an exact SPA redirect URI in Entra without changing permissions.
7. Publish Pages and verify live HTML, manifest, service worker, mascot icons and login redirect.

### Task 6: Production acceptance

1. Verify the live PWA opens only the chat at `/energetico/`, installs with the mascot metadata and can authenticate.
2. Test text, photo and file paths; force a failure and prove pending data remains.
3. Issue a Shortcut token, test a binary upload, revoke it and prove reuse returns 401.
4. Run the complete test suites again and scan tracked output for secrets.
5. Record separately what is live and the two manual iPhone actions still required.
