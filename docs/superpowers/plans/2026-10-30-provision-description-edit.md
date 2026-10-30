# Provision Description Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Editar colunas do descritivo durante a baixa e continuar somente com snapshots atualizados.

**Architecture:** Editor existente da galeria mantém catálogos e fanout; a VM mantém barreira durável, token e releitura do grupo. UI e backend têm arquivos distintos e testes com dados fictícios.

**Tech Stack:** Python WorkflowEngine, JavaScript, Graph/SharePoint, DynamicForm, Vite/Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-30-provision-description-edit-design.md`

## Global Constraints

- Títulos exatamente conforme pedido; botão do pai abaixo da edição de linha.
- Preservar opções fechadas, ETags, fanout, seleção, anexos e baixa parcial.
- Não tocar nas áreas de assinatura nem usar registros financeiros reais em QA.
- Publicar backend e clientes após revisão independente.

## Review Focus

- Troca de conta/descritivo e respostas tardias não podem editar ou destravar outro fluxo.
- Sincronização parcial, confirmação perdida e refresh falho não autorizam baixa com dados antigos.
- Filial/fornecedor/valor alterados no pai devem aparecer nos filhos relidos, sem restaurar respostas antigas.
- Campos imutáveis e opções fora do catálogo permanecem recusados.
- Cancelar, seleção vazia e filho já pago não causam gravação ou seleção indevida.

### Task 1: Backend

- [x] RED: rótulos, início/retorno com token, bloqueio de submissão, releitura e retentativa.
- [x] Implementar no mixin de baixa e hooks mínimos necessários, preservando rascunhos seguros.
- [x] Regressões de baixa parcial, etapa, anexos e fechamento do pai.

### Task 2: Interface

- [x] RED: coluna por botão, escolhas reais, salvar/cancelar, contexto e falha de refresh.
- [x] Reutilizar editor/fanout existente; bloquear avanço até confirmação da VM.
- [x] Verificar 320/390/1365px, build e guard de assinatura.

### Task 3: Publicação

- [x] Revisão independente, pacote privado com CAS/backup/rollback e manifesto público.
- [ ] Commit/PR/merge e verificação da instalação do backend.
- [ ] Conferir publicações PC, Android interno e TestFlight; abrir o app publicado.
