# Diary Attachment Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Mostrar progresso real de 0 a 100% ao finalizar anexos do diário.
**Architecture:** Telemetria contextual na VM, consulta autenticada sem lock e
callback no cliente; etiqueta opcional no loading existente.
**Tech Stack:** Python, JavaScript, Node test runner, jsdom, Vite, Capacitor.
**Spec:** docs/superpowers/specs/2026-10-21-diary-attachment-progress-design.md

## Global Constraints

- Preservar os 14 blocos de assinatura, mudanças preexistentes e registros reais.
- Não reenviar arquivos nem executar o fluxo por consultas.
- 100 somente após confirmação válida de sucesso, nunca por temporizador.
- Publicar web/Windows, Android interno e TestFlight.

## Review Focus

- Consulta de outro usuário/tenant não revela progresso nem bloqueia a conversa.
- Recompressão não reduz percentual e falha nunca termina em 100.
- Consulta atrasada não altera uma nova sessão/requisição.
- Servidor antigo/consulta indisponível não quebra a finalização principal.
- Valores inválidos não aparecem como NaN, Infinity ou HTML no badge.

### Task 1: Backend progress protocol

**Files:** backend-patches/diary-attachment-progress/{diary_progress.py,patch_backend.py,test_diary_progress.py}
**Interfaces:** progress_scope(identity, message_id) binds emit_progress(percent,stage);
ProgressRegistry.snapshot(identity,message_id) returns requestId,percent,stage,status.

- [ ] Write tests for isolation, expiry, bounded registry, monotonic values and
  concurrent reads while a builder is blocked; run and observe RED.
- [ ] Implement optional registry/context and precise guarded patches to current
  channel_bridge.py and worker/diary_evidence.py. Main handler records success
  only after its public result is prepared. Status handler returns directly.
- [ ] Run backend tests plus original diary tests against patched current files;
  verify GREEN, compile and commit.

### Task 2: Client and visual progress

**Files:** apps/energetico-mobile/src/{chat/chat-client.js,chat/diary-attachment-progress.js,app-controller.js,ui/loading-indicator.js,ui/chat-view.js,styles.css}
**Tests:** dedicated progress tests and existing client/controller/view tests.
**Interfaces:** sendText accepts optional onProgress callback; getDiaryAttachmentProgress
queries action=diary_evidence_progress with requestId; callback receives percent/status/stage.

- [ ] Write tests for 0/intermediate/100, failed finalization, abort, telemetry
  failure, stale responses, diary-only scope and safe accessible badge. Observe RED.
- [ ] Implement sequential polling with cancellation, controller request/session
  scope, optional loading badge and responsive styles. Preserve other loaders.
- [ ] Run focused and complete mobile suites, signature guard, Vite builds;
  inspect mobile/desktop badge in browser and commit.

### Task 3: Review, deployment and publication

**Interfaces:** consumes Task 1 telemetry and Task 2 optional client callback.

- [ ] Independent whole-branch review; fix important findings with RED/GREEN.
- [ ] Stage exact VM patch with checksum guard, backup and compile/tests; restart
  bridge and verify healthy service and authenticated protocol behavior.
- [ ] Merge PR, track matching Pages, Android and iOS uploads; record evidence
  without calling queued/failed releases published.
