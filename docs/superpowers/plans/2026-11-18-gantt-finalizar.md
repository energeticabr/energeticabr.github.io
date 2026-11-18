# Finalização no Gantt Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Colocar FINALIZAR abaixo de cada nome no Gantt e sugerir a última presença de DESCRITIVOPRESENCA.
**Architecture:** Preservar os registros normalizados no modelo Gantt. Usar a consulta completa de presenças existente, por filial e IDs vinculados, em diálogo próprio e reutilizar as gravações com controle de concorrência existentes.
**Tech Stack:** JavaScript, DOM, SharePoint Graph, node:test, JSDOM, Vite.
**Spec:** Pedido e três fotos fornecidos nesta conversa. Botão verde abaixo do nome; diálogo com data fim editável, cancelar e submeter; padrão igual à maior data de presença vinculada.

## Global Constraints
- Preservar os 14 blocos de gestos protegidos.
- Preservar a exigência de finalizar todos os descritivos antes da etapa.
- Publicar web/Windows, Google Play internal e TestFlight; verificar cada destino.

## Review Focus
- Filiais e IDs diferentes não podem contaminar a data sugerida.
- Consulta incompleta ou sem presenças deixa data vazia e permite digitação.
- Cancelamento descarta respostas atrasadas e nunca grava.
- Duplo envio e mudanças concorrentes não duplicam nem sobrescrevem registros.
- Retorno da autorização Microsoft preserva item/data e reabre o Gantt sem gravar sozinho.

### Task 1: Finalização e integração
**Files:** stage-progress-model.js, stage-gantt-view.js, novo stage-gantt-finish-view.js, stage-gantt.css, app-controller.js; testes Gantt e controller.
- [ ] Escrever testes de data máxima, dados de origem, gravação manual, cancelamento e erro; executar e observar falhas esperadas.
- [ ] Preservar origem e disponibilidade de finalização no modelo; criar diálogo com consulta e gravação existentes; integrar botões, atualização e retomada de consentimento.
- [ ] Executar testes focados e de layout, guarda de gestos, builds nativo/PWA e suíte do projeto.
- [ ] Revisar diff completo e corrigir achados; commit e PR.

### Task 2: Publicação
- [ ] Mesclar revisão validada e acompanhar workflows oficiais.
- [ ] Conferir JS/CSS públicos e envios Android internal/TestFlight da revisão que contém a alteração.
