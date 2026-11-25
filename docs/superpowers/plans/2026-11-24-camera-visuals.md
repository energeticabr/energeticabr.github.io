# Visuais de câmeras — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar visuais nomeados com até oito câmeras e abrir cada visual em uma grade ao vivo.

**Architecture:** A tela `createCamerasView` passa a alternar entre as abas **Câmeras** e **Visuais**. A criação reutiliza a seleção de até oito canais, solicita o nome em um diálogo e grava `{name, cameraIds}` em `localStorage` sob uma chave separada por conta. Abrir um visual resolve seus IDs nos canais carregados e reutiliza `openPlayer`/`prepareGrid`.

**Tech Stack:** JavaScript ES modules, CSS, jsdom e Node test runner, Vite/PWA, Capacitor iOS e Android.

**Spec:** `docs/superpowers/specs/2026-11-24-camera-visuals-design.md`

## Global Constraints

- O limite do visualizador atual é `GRID_LIMIT = 8`; a criação respeita o mesmo limite.
- A persistência de câmera deve ser isolada por `accountKey` e permanecer local ao dispositivo.
- O código da tela é compartilhado pelo PWA e pelos apps Capacitor.
- Os blocos entre `SIGNATURE_GESTURE_LOCK_START` e `SIGNATURE_GESTURE_LOCK_END` são protegidos.
- Distribuição autorizada pelo repositório: TestFlight com `distribute=true`; Google Play interna com `build_play_aab=true` e `publish_play=true`; PWA pelo GitHub Pages para Windows.

## Review Focus

- Nome vazio ou falha de armazenamento: manter o diálogo aberto e não anunciar sucesso. Coberto pela validação/salvamento em `cameras-view.test.mjs`.
- Contas distintas: não mostrar os visuais de outra conta. Coberto pelo teste de isolamento por `accountKey`.
- Visual salvo com canal que não foi carregado: não abrir grade vazia e informar o estado; com membros restantes, abrir apenas os disponíveis. Coberto pelo teste de membros indisponíveis.
- Nomes iguais ou alterados: identificar câmeras pelo ID salvo. Coberto pelo teste de seleção e abertura usando IDs.
- Oito câmeras e telas pequenas: respeitar `GRID_LIMIT` e não criar rolagem horizontal nos cartões/tabs. Coberto pelos testes de limite e layout em 320 px.

---

### Task 1: Criar, salvar e abrir visuais

**Files:**
- Modify: `apps/energetico-mobile/src/ui/cameras-view.js`
- Modify: `apps/energetico-mobile/src/ui/cameras-view.css`
- Test: `apps/energetico-mobile/tests/cameras-view.test.mjs`
- Modify: `apps/energetico-mobile/tests/fixtures/cameras-layout.html`
- Modify: `apps/energetico-mobile/tests/cameras-layout-browser.test.mjs`

**Interfaces:**
- Consumes: `createCamerasView(documentRef)` recebe `accountKey`, `list`, `start` e `prepareGrid`, como atualmente.
- Produces: aba **Visuais**, criação por seleção e nome, armazenamento local por conta e abertura via o player/grade existente, com título do visual e aviso visível para membros ausentes.

- [ ] **Step 1: Escrever testes falhos** para criar e salvar um visual; recuperar visuais ao reabrir; isolar contas; abrir IDs na ordem salva; identificar o player pelo nome do visual; mostrar aviso de canais ausentes; validar nome/erro de armazenamento; e medir abas/cartões na fixture de layout.
- [ ] **Step 2: Rodar os testes focados e confirmar falha pelo recurso ausente.**

  Run: `pnpm --dir apps/energetico-mobile exec node --test tests/cameras-view.test.mjs tests/cameras-layout-browser.test.mjs`

- [ ] **Step 3: Implementar o fluxo mínimo** em `cameras-view.js` e os estados de tab, lista, criação e cartões em `cameras-view.css`.
- [ ] **Step 4: Rodar novamente os testes focados e confirmar sucesso** nos testes de unidade e no navegador disponível.

- [ ] **Step 5: Commitar somente os arquivos do recurso e dos testes.**

  Run: `git add docs/superpowers/specs/2026-11-24-camera-visuals-design.md docs/superpowers/plans/2026-11-24-camera-visuals.md apps/energetico-mobile/src/ui/cameras-view.js apps/energetico-mobile/src/ui/cameras-view.css apps/energetico-mobile/tests/cameras-view.test.mjs apps/energetico-mobile/tests/cameras-layout-browser.test.mjs apps/energetico-mobile/tests/fixtures/cameras-layout.html && git commit -m "feat(mobile): save camera visuals"`

### Task 2: Validar layout compartilhado e preparar publicação

**Interfaces:**
- Consumes: a tela completa de câmeras com a aba **Visuais** implementada na Task 1.
- Produces: prova do layout dos cartões e abas em retrato, paisagem e desktop, além dos pacotes de distribuição.

- [ ] **Step 1: Executar a suíte completa de `apps/energetico-mobile`, `pnpm guard:signature-gestures`, `pnpm build:pwa`, sincronização/verificação Android e `pnpm ios:verify`.**
- [ ] **Step 2: Enviar esta revisão ao GitHub e disparar os três destinos autorizados**: TestFlight, faixa interna Google Play e GitHub Pages. Aguardar e conferir cada execução independentemente antes de informar publicação.

**Review Focus:** Falha do Chrome no runner, secrets ausentes, ambiente `app-store-connect` aguardando aprovação, Android track/credenciais e branch do PWA. Conferir o status real de cada execução; build local não equivale à publicação.
