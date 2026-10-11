# Plano: provisões por descritivo

Classe: arquitetural. Execução inline do coordenador com subtarefas independentes e revisão final limpa. O usuário determinou execução e publicação sem nova aprovação de desenho.

Spec: `docs/superpowers/specs/2026-10-11-grouped-provision-settlement-design.md`.

## Task 1 — Leitura, agrupamento e contrato

Arquivos: novo módulo worker/provision_description_settlement.py, worker/clients.py, channel_bridge.py, testes Python específicos.

1. Escrever testes que falham para grupos, somas, filhos pagos, erros e paginação.
2. Consultar pais/filhos completamente, gerar opções com namespace e snapshot do grupo.
3. Atualizar fonte dos relatórios relacionados. Testar contrato e falha sem lista vazia.

## Task 2 — App e popup

Arquivos: apps/energetico-mobile/src/app-controller.js, src/chat/orders-gallery-data.js, src/ui/chat-view.js e testes associados.

1. Testes red para IDs pai/filho, enriquecimento legado, anexos e atalho check.
2. Provedor de anexos/vencimento por sourceKind, metadados de grupos e seleção com namespace.
3. Preservar fechamento imediato/abandono autorizado, gestos e fluxo legado. Testes e prévia móvel.

## Task 3 — Preparação e baixa sequencial

Arquivos: worker/provision_description_settlement.py, hooks mínimos em worker/workflow.py e configuração dinâmica, testes workflow.

1. Testar seleção, perguntas comuns uma vez, dados individuais, resumo e zero escrita antes de confirmar.
2. Preparar todos os contextos; gravar pai primeiro e filhos um por um, verificando cada gravação.
3. Testar falha parcial, retomada, idempotência, concorrência, vínculos alterados e compatibilidade dos rascunhos.

## Task 4 — Empacotar, revisar, publicar e conferir

Arquivos: backend-patches/grouped-provision-settlement, documentos de execução/publicação.

1. Guard de assinatura, suites completas, build e comparação com baseline.
2. Revisão independente limpa com correção dos achados.
3. PR, merge, deploy pinado da VM com backup/rollback, releases web/Play interno/TestFlight.
4. Conferir saúde/contrato real e popup no app sem baixar pagamentos reais. Registrar evidências e versões.
