# Payroll Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernizar relatório de folhas com edição, CSV, cores e totais por todos os tipos e período completo.

**Architecture:** Modelo puro para período/cores/CSV; dados continuam leitura SharePoint com enriquecimento dos lançamentos. View reutiliza gallery-record-actions e controller injeta edição/exportação existentes com guarda da sessão.

**Tech Stack:** JavaScript, DOM/CSS, decimal.js, Node tests/JSDOM, Vite.

**Spec:** docs/superpowers/specs/2026-10-10-payroll-dashboard-design.md

## Global Constraints

- Não alterar 14 blocos protegidos de assinatura.
- Publicar web/Windows, Play internal e TestFlight via merge automático.
- Pagamentos vinculados após o mês permanecem incluídos; valores desconhecidos não viram zero.
- Usuário autorizou execução sem pausa de aprovação; implementar inline, revisão independente ao fim.

## Review Focus

- Todos os tipos e rótulos longos preservados e somados sem cortes.
- Exportação abortada no fechamento/falha de qualquer fornecedor, sem arquivo parcial.
- Edição mantém identidade de pagamento versus lançamento e usa política de fonte financeira existente.
- Respostas antigas após salvar/fechar/trocar conta não restauram valores obsoletos.
- CSV neutraliza fórmulas e escapa separadores/aspas/quebras; período bissexto e Todos corretos.

### Task 1: Painel completo

**Files:** src/chat/supplier-payroll-report-model.js, src/chat/supplier-payroll-report-data.js, src/ui/supplier-payroll-report-view.js, src/ui/supplier-payroll-report.css, src/app-controller.js e testes correspondentes.

**Interfaces:** Modelo exporta payrollReferencePeriod(month), payrollTypeAppearance(type), buildPayrollReportCsv(groups). View recebe loadEditor(id, options), saveEditor(context, fields, options), loadLaunchEditor(id, options), saveLaunchEditor(context, fields, options), exportMedia(blob, fileName). Dados retornam description/paymentMethod/observations junto aos campos existentes.

- [x] Escrever e executar RED para períodos completos, tipos adicionais/cores, CSV seguro, enriquecimento do lançamento, ações de edição, recálculo após salvar e exportação filtrada atômica/cancelável.
- [x] Implementar modelo, enriquecimento opcional sem fragilizar esquemas, tabela/blocos/CSS e callbacks de sessão para formulários existentes e exportMedia.
- [x] Executar GREEN focado e layout em telefones horizontais/tablet/PC; verificar manualmente resultado no navegador com dados fictícios, exportação e formulário sem salvar dados reais.
- [ ] Executar pnpm test completo, build, build:pwa, ios:verify, secrets:verify, guard e git diff --check; corrigir falhas com RED/GREEN.
- [x] Revisão independente da branch; corrigir achados relevantes com regressão.
- [ ] Commit, PR, merge e confirmar publicações nas três plataformas e resultado no app publicado.
