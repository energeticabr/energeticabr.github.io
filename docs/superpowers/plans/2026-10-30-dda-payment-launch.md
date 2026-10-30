# DDA pago para lançamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Oferecer lançamento com anexos da linha após confirmação do pagamento DDA.

**Architecture:** Diálogo existente recebe callback `onStartLaunch({itemId,key,signal})`. Galeria e relatório encaminham o callback; controller prepara os arquivos e abre o lançamento normal.

**Tech Stack:** JavaScript, Node test runner, JSDOM, Vite, Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-30-dda-payment-launch-design.md`

## Global Constraints

- Preservar os 14 blocos protegidos de assinatura.
- Não repetir confirmação do pagamento ao tentar iniciar lançamento novamente.
- Não submeter lançamento automaticamente nem remover anexos do DDA.
- Preservar anexos existentes; respeitar conta, sessão e cancelamento.
- Publicar PC/web, Android interno e iOS/TestFlight após validação.

## Review Focus

- Resposta tardia após encerrar galeria/logout não deve transferir arquivos.
- Falha em um download não deve iniciar fluxo com lote parcial.
- Tentativas de encaminhamento não devem duplicar anexos nem confirmar pagamento novamente.
- DDA sem anexos ainda pode iniciar lançamento com bandeja preservada.
- Nomes extensos e tela de 320px devem manter botões legíveis.

### Task 1: Pergunta após confirmação

- [x] Adicionar testes falhando em `tests/dda-payment-launch.test.mjs`: confirmação antes da pergunta; Não não inicia; Sim envia identidade correta; tentativa após falha não confirma pagamento novamente; fechamento ignora resposta tardia.
- [x] Implementar fase de oferta em `src/ui/dda-payment-confirmation.js` e encaminhar callback em `registration-gallery-view.js` e `dda-report-view.js`.
- [x] Executar testes focados e verificar layout com dados fictícios a 320/390px.

### Task 2: Transferência dos anexos e início do fluxo

- [x] Cobrir com testes falhando o download de todos os anexos do item, lote incompleto, bandeja existente, duplicatas e sessão expirada.
- [x] Integrar callback no controller e helper focado, reutilizando fila/fluxo existentes.
- [x] Verificar galeria e relatório com controller usando dependências fictícias.

### Task 3: Validação e publicação

- [ ] Revisão independente, suíte móvel, testes de portal pertinentes, builds, guard e segredos.
- [ ] Commit, PR, merge e acompanhar publicações da mesma revisão.
- [ ] Abrir app público e confirmar assets; registrar envio Android interno e associação iOS/TestFlight.

## Registro de validação

Os seis testes da oferta foram observados em RED antes da implementação e passaram em GREEN. A revisão independente identificou dois P2: resposta de upload sem snapshot e duplicação por renovação de IDs; ambos receberam reprodução RED e correção GREEN. O fechamento da galeria após sucesso também foi observado em RED e corrigido em ambos os painéis. Quinze cenários de navegador passaram em 320/390/1365px com dados fictícios, incluindo falha, nova tentativa e recusa. Publicações serão registradas no comprovante privado da tarefa após os fluxos remotos concluírem.
