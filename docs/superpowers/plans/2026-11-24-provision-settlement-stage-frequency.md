# Frequência de etapas na baixa de pagamento — Plano de implementação

> **For agentic workers:** Use a implementação nativa deste plano, tarefa a tarefa.

**Goal:** Ordenar as etapas de `payment_settlement/etapa_baixa` pela frequência nos 100 lançamentos mais recentes.

**Architecture:** Estender o helper existente no `worker/workflow.py`, consultando somente `Id` e `ETAPA` da lista `LANCAMENTOS`. Um pacote de implantação com hashes e rollback publica a alteração no backend compartilhado; clientes existentes recebem a regra sem novo binário.

**Tech Stack:** Python, SharePoint connector, systemd, Bash/SSH.

**Spec:** `docs/superpowers/specs/2026-11-24-provision-settlement-stage-frequency-design.md`

## Global Constraints

- Aplicar apenas a `payment_settlement/etapa_baixa`; preservar `launch/etapa_lancamento`.
- Usar `LANCAMENTOS` com `Id` decrescente, `ETAPA` e limite 100.
- Manter a ação `NOVA_ETAPA_BAIXA_PROVISAO` primeiro, opções sem uso disponíveis e empate na ordem do catálogo.
- Em falha da consulta, retornar a lista original sem bloquear a baixa.
- Não gravar dados financeiros, anexos ou rascunhos durante o ranking.
- Publicar no backend compartilhado para Android, iOS e Windows/web; manter o espelho de build somente leitura.

## Review Focus

- `launch/etapa_lancamento`: o ranking atual deve continuar idêntico.
- `payment_settlement/etapa_baixa`: somente opções de etapas são ranqueadas; a ação de cadastro continua no topo.
- Histórico com mais de 100 itens ou fora de ordem: só os 100 maiores `Id` contam.
- Valores vazios e etapas sem uso: vazios não pontuam; etapas sem uso continuam disponíveis.
- Empates e falha de consulta: ordem anterior preservada; o fluxo continua disponível.

## Tarefa 1: Preparar e publicar o patch compartilhado

**Arquivos:**
- Criar `backend-patches/provision-settlement-stage-frequency/patch_backend.py` para estender a guarda e o ranking.
- Criar `source.patch`, `deploy.py`, `package.py`, `deployment_gate.sh`, `deploy.sh`, `deploy-manifest.json`, `README.md` e `verification.md` para registrar e instalar somente `worker/workflow.py`.
- Atualizar o design e este plano com os hashes e o resultado da publicação.

**Interface:** `_rank_recent_launch_stage_options(state, step, options)` continua recebendo e retornando a lista existente; a fonte permanece `LANCAMENTOS/ETAPA`.

- [x] Alterar o helper para habilitar o par `payment_settlement/etapa_baixa` e manter a ação `NOVA_ETAPA_BAIXA_PROVISAO` no topo.
- [x] Gerar o diff público e o pacote com hashes da fonte de produção e do espelho somente leitura.
- [x] Conferir o código candidato por revisão de diff e compilação Python, sem executar testes.
- [x] Fazer a checagem de implantação; confirmar baseline e saúde antes de instalar. A instalação aguarda até 60 segundos pelo cold start do bridge.
- [x] Instalar sob o lock e gate existentes, manter backup, reiniciar o serviço de chat e confirmar hash ativo, espelho inalterado, saúde do serviço e HTTPS.
- [x] Registrar revisão, backup, hashes e saúde em `backend-patches/provision-settlement-stage-frequency/verification.md`.
- [x] Revisar o instalador e corrigir o watchdog para acompanhar o processo até o fim do rollback; validar hashes e executar o Python a partir do snapshot privado.
- [ ] Fazer revisão independente dos ajustes do instalador, commitá-los e publicar o branch no GitHub.

**Resultado esperado:** a lista de etapas da baixa mostra as mais usadas primeiro, sem alterar as opções, os valores escolhidos ou os dados financeiros.
