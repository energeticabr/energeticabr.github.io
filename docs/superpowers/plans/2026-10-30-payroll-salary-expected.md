# Payroll Salary Expected Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Exibir salário pago / mensal esperado no cluster verde da folha.

**Architecture:** Snapshot paginado inclui RH e salários por cargo; um modelo puro resolve vínculo e vigência. A visão reaproveita o pago e adiciona o esperado sem duplicá-lo por IDFOLHA.

**Tech Stack:** JavaScript, Graph/SharePoint repository, Decimal, JSDOM, Vite/Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-30-payroll-salary-expected-design.md`

## Global Constraints

- Apenas leitura financeira; QA fictício, sem pagamentos reais.
- Guard de assinatura antes/depois; todos os canais autorizados.
- Valores desconhecidos não viram zero; os pagos continuam visíveis.

## Review Focus

- Homônimos ou vínculos RH duplicados não recebem salário de outra pessoa.
- Mês histórico usa vigência correta; futuro não substitui passado.
- Múltiplas folhas no mês não duplicam salário esperado.
- Cancelamento, refresh e erro de RH não exibem salário de snapshot antigo.
- Valores maiores e ausência de salário não cortam o cluster no celular.

### Task 1: Fonte e modelo

- [x] Escrever testes RED para vínculo ID, vigência, duplicidade, ausência, paginação/cancelamento.
- [x] Implementar leitura RH/CARGOS e cálculo do esperado por competência distinta.
- [x] Verificar regressões de dados e filtros do relatório.

### Task 2: Cluster

- [x] RED e implementação do texto pago / esperado apenas em SALÁRIO.
- [x] Verificar filtros, impressão, layout em 320/390 px e desktop, build e guard.

### Task 3: Revisão e publicação

- [ ] Revisão independente, commit, PR e integração.
- [ ] Confirmar web/Windows, Android interno, TestFlight e abrir o app publicado.
