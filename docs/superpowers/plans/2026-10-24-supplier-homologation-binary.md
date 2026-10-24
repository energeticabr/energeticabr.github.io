# Supplier homologation binary answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Perguntar homologação com SIM/NÃO e gravar exatamente a escolha.

**Architecture:** Patch estreito na configuração e renovação das opções em cache.
Servidor e espelho independentes, hashes de origem fixados, sem mudança nos clientes.

**Tech Stack:** Python 3.9, WorkflowEngine, ChannelMessenger, SharePoint static catalog.

**Spec:** docs/superpowers/specs/2026-10-24-supplier-homologation-binary-design.md

## Global Constraints

- Preservar IDs e valores legados; não modificar outras perguntas.
- Não alterar dados existentes nem publicar registros de teste no SharePoint.
- Publicar servidor e espelho para Android, iOS e Windows existentes.
- Não editar blocos protegidos de assinatura ou publicar em lojas de produção.

## Review Focus

- EMPREITEIRO ausente/NÃO deve oferecer ambas as respostas, sem trocar o ID antigo.
- Botões antigos devem preservar o valor; expandir deve apenas reapresentar a pergunta.
- Retomada não deve reutilizar a confirmação armazenada.
- Origem não alvo e demais recomendações devem permanecer idênticas.
- Publicação deve recusar origem divergente e preservar rollback recuperável.

### Task 1: Escolha binária compartilhada

**Files:** Create `backend-patches/supplier-homologation-binary/{test_homologation.py,patch_backend.py,deploy.py,deploy-manifest.json}`.

**Interfaces:** Consumes independently captured workflow/config bytes. Produces
`patch_config(config)`, `patch_workflow(source)`, and `generate(source, output)`
with before/after hashes for four exact destination files.

- [ ] Write behavioral tests using real WorkflowEngine, static SharePoint catalog
  resolution and ChannelMessenger. Assert both emitted labels/values, absence of
  filter copy, persistence, navigation, cached replies, resume and unrelated defaults.
- [ ] Run against captured live code; expect failures showing `SIM, MANTER` and
  only one actual answer option.
- [ ] Implement config-only presentation removal, preserving conditional IDs;
  refresh only this step before reply resolution. Reject stale expand by re-prompt.
- [ ] Run the new tests on app and build candidates, patch/deploy safety tests,
  existing backend unittest suite with baseline comparison for any failures, and
  app poll presentation tests. Expected: new/focused tests pass; no new failures.
- [ ] Inspect the emitted payload in the real chat renderer at mobile widths;
  commit, obtain one fresh review, and fix important findings test-first.
- [ ] Merge and publish four exact backend targets with shared locks/CAS,
  backup and service health checks. Independently rerun tests on installed files
  and verify the shared outcome. Record receipts before reporting completion.
