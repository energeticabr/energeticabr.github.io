# SEFAZ Last Successful Update Cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar e preservar na galeria fiscal a data/hora da última sincronização concluída com sucesso nas três fontes.

**Architecture:** A fila autenticada calcula o último sucesso do proprietário e o inclui na descoberta de pedidos. O monitor valida, persiste e expõe o instante; a galeria renderiza um cluster neutro alimentado por esse estado.

**Tech Stack:** Python 3, JavaScript ESM, Node test runner, JSDOM, CSS responsivo.

**Spec:** `docs/superpowers/specs/2026-10-30-sefaz-last-success-cluster-design.md`

## Global Constraints

- Um sucesso global exige NF-e, CT-e e NFS-e nacional em `succeeded`.
- Espera, parcial, erro e cooldown não podem substituir o último sucesso.
- Formatação em `pt-BR` e `America/Sao_Paulo`.
- Preservar os blocos `SIGNATURE_GESTURE_LOCK_START`/`END`.

## Review Focus

- Armazenamento antigo sem o novo campo continua abrindo normalmente.
- Um timestamp inválido vindo do servidor é rejeitado sem apagar o cache válido.
- Resultado parcial posterior não regride a data do último sucesso.
- ACK remove o pedido, mas não remove a medida.
- O cluster não quebra em 320 px.

---

### Task 1: Último sucesso na fila autenticada

**Files:**
- Modify: `backend-patches/sefaz-manual-sync/sefaz_sync.py`
- Test: `backend-patches/sefaz-manual-sync/test_sefaz_sync.py`

**Interfaces:**
- Produces: `Queue.pending(identity) -> {status, requests, lastSuccessfulUtc?}`

- [ ] Escrever teste que cria sucessos reconhecidos e confirma que o mais recente continua retornando em `lastSuccessfulUtc`.
- [ ] Executar o teste e observar a falha pela ausência do campo.
- [ ] Calcular o maior `completedUtc` de jobs `succeeded` pertencentes ao proprietário.
- [ ] Executar os testes do backend e confirmar sucesso.

### Task 2: Persistência e regra monotônica no monitor

**Files:**
- Modify: `apps/energetico-mobile/src/chat/sefaz-sync-monitor.js`
- Test: `apps/energetico-mobile/tests/sefaz-sync-monitor.test.mjs`

**Interfaces:**
- Consumes: `lastSuccessfulUtc` da resposta autenticada de pendências.
- Produces: `snapshot().lastSuccessfulAt: number | null`

- [ ] Escrever testes para sucesso, ACK/reinício, parcial posterior e timestamp inválido.
- [ ] Executar os testes e observar as falhas esperadas.
- [ ] Persistir o maior instante confirmado e expô-lo no snapshot.
- [ ] Executar os testes focados e confirmar sucesso.

### Task 3: Cluster responsivo na galeria

**Files:**
- Modify: `apps/energetico-mobile/src/ui/registration-gallery-view.js`
- Modify: `apps/energetico-mobile/src/ui/registration-gallery.css`
- Test: `apps/energetico-mobile/tests/sefaz-sync.test.mjs`
- Test: `apps/energetico-mobile/tests/sefaz-sync-global-browser.test.mjs`

**Interfaces:**
- Consumes: `syncMonitor.subscribe(state.lastSuccessfulAt)`
- Produces: `[data-sefaz-last-success]` com título e valor formatado.

- [ ] Escrever teste DOM para valor vazio, atualização por sucesso e preservação durante espera.
- [ ] Executar o teste e observar falha pela ausência do cluster.
- [ ] Renderizar o cluster neutro com ícone, rótulo e data/hora.
- [ ] Executar testes focados e inspeção em 320/390 px.

### Task 4: Verificação e publicação

**Files:**
- Verify only.

- [ ] Executar novamente `pnpm guard:signature-gestures`.
- [ ] Executar a suíte móvel completa, build web/PWA e sincronizações Android/iOS aplicáveis.
- [ ] Publicar a mesma revisão nos canais web/Windows, Android interno e TestFlight e acompanhar cada CI até estado terminal.
