# Contractor Employment Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro, espelhamento idempotente e galeria de funcionários com cargo e datas.
**Architecture:** FORNECEDORES é a fonte; FUNCIONARIOSRH é espelho histórico por ID de origem. Commit compartilhado sincroniza e timer reconcilia; app usa repositório Graph autenticado e ETags.
**Tech Stack:** Python/backend SharePoint REST, JS/Graph, Node test, systemd, Capacitor.
**Spec:** docs/superpowers/specs/2026-10-20-contractor-employment-register-design.md

## Global Constraints

- Sem cálculos/execução de folha, sem apagar registros, sem inventar datas/cargos.
- Preservar todos os campos originais e os blocos de assinatura; sem dados pessoais públicos.
- Lista `FUNCIONARIOSRH`; origem `FORNECEDORES`; chave `IDFORNECEDORORIGEM` única.
- `CARGO`, `DATAADMISSAO`, `DATADESLIGAMENTO`; datas date-only; oito cargos do spec.
- Publicar Android internal, iOS TestFlight e web/Windows, além do backend.

## Review Focus

- Confirmação repetida ou timeout remoto: uma linha por ID, sem falso sucesso.
- Sessão anterior aos novos campos: manter etapa correta e completar dados faltantes.
- Inativação com data inválida/anterior à admissão ou cancelada: nenhuma gravação.
- Campos legados adicionais e anexos: preservados sem conversão silenciosa/duplicação.
- Falha entre fonte e espelho: erro explícito e reconciliação, nunca outra contratação.

### Task 1: Esquema e sincronizador (módulo independente)

**Files:** backend-patches/contractor-employment-register/; candidato privado worker/contractor_employment.py e worker/sync_contractors.py.
**Interfaces:** `sync_supplier(client, supplier_id, *, state_store=None) -> dict`; `sync_all(client, *, state_store=None) -> dict`. Colunas conforme Global Constraints; source snapshot por ID.

- [x] Escrever e executar testes RED de criação/atualização por ID único, filtros SIM/ATIVO, manutenção INATIVO, campos/auditoria/anexos e timeout.
- [x] Implementar provisionamento aditivo com dry-run e sincronizador, locks compartilhados quando state_store disponível, nunca repetir POST incerto sem reconciliação.
- [x] Executar testes GREEN e registrar recibos; preparar timer com usuário/ambiente reais, sem editar credenciais.

### Task 2: Perguntas no cadastro compartilhado (controlador principal)

**Files:** candidato privado worker/workflow.py, worker/workflow_config.json; testes novos do motor.
**Interfaces:** importa `sync_supplier` de Task 1 após gravação original e antes do sucesso; reutiliza `submitted_item_id`/checkpoint existente.

- [x] Testar RED oito opções/todos os vínculos, admissão válida, NÃO, mudança de opção, migração de sessões e bloqueio antes de gravar.
- [x] Ajustar cargo para qualquer SIM; inserir admissão; migrar versão/índices; conferir dados antes de commit e sincronizar fornecedor confirmado.
- [x] Testes GREEN focados, contratos anteriores e comparação da suíte legada com baseline.

### Task 3: Galeria e inativação (cliente independente)

**Files:** apps/energetico-mobile/src/chat/contractor-employment-data.js, ui/contractor-employment-view.js/css, integração app-controller.js/chat-view.js; portal/forms/ e testes.
**Interfaces:** dados via repositório Graph existente, listas e colunas Global Constraints; `createContractorEmploymentData` e `createContractorEmploymentView`; menu `action_hr_gallery_funcionarios`.

- [x] Testes RED do menu abaixo de Presenças, carregamento paginado, detalhes, filtro completo, regularização e inativação/cancelamento/ETag/falha parcial.
- [x] Implementar galeria no padrão atual; gravação fonte primeiro e espelho segundo, ID estável; datas obrigatórias e cargo fechado; formulário do portal exige desligamento.
- [x] Testes GREEN, guard de assinatura e prova visual responsiva sem gravações reais.

### Task 4: Integração, revisão e publicação

**Files:** pacote backend reproduzível, documentação/recibos sem dados pessoais.

- [ ] Rodar suíte do projeto, contratos backend e provisionamento dry-run; revisão independente e corrigir achados com RED/GREEN.
- [ ] Provisionar esquema aditivo e sincronizar ativos reais autorizados; conferir contagens/identidades, nunca mostrar dados pessoais em logs públicos.
- [ ] Instalar backend com hash/backup/saúde, confirmar a galeria publicada, PR/merge e acompanhar as três plataformas.
- [ ] Registrar testes, limitações e recibos; entregar apenas estados efetivamente verificados.

## Estado de execução em 20/10/2026

Implementação local: 88 testes backend e 526 testes finais direcionados do cliente aprovados.
A suíte completa final do cliente teve 6.734 aprovados e dois skips; root/portal,
1.124 aprovados e seis skips. Builds web/PWA e 14 blocos de assinatura verificados.
Recibos e limitações: `backend-patches/contractor-employment-register/verification.md`.

**Ativação bloqueada por autorização:** FORNECEDORES possui permissões exclusivas e
a integração recebeu 403 ao consultar roleassignments. Sem prova de equivalência de
acessos, não criar/povoar a nova lista nem publicar o fluxo/galeria/timer de RH.
É necessário operador com autoridade administrativa existente; não ampliar escopos
nem conceder privilégios ao aplicativo. Código preservado como draft, não concluído.

A correção independente do vencimento de descritivos segue em outra branch/PR e
não libera a ativação deste cadastro.
