# Nome selecionável do imobilizado Implementation Plan

> Execução inline e revisão independente conforme superpowers:executing-plans.

**Goal:** Tornar o nome/ID um botão visualmente aparente no cadastro, abrindo o relatório já implementado.
**Architecture:** Botão nativo no cabeçalho existente do cartão, reaproveitando vínculo por ID e modal. Retirar o alvo amplo de clique do corpo cadastral, conservando o comportamento dos lançamentos.
**Tech Stack:** DOM/CSS, node:test, JSDOM e browser headless existente.
**Spec:** docs/superpowers/specs/2026-11-02-asset-report-design.md, seção Nome selecionável no cadastro.

- [x] RED/GREEN: cabeçalho deve conter botão nome/ID com indicação de abertura; corpo sem role button; clique consulta ID96 e não ID do histórico. Tab/Enter/Espaço e anexos/editar independentes.
- [x] Implementar botão e aparência na integração registration-gallery-view.js e asset-report.css; conferir layout a 320/390/1365px, inclusive cabeçalho longo e ações independentes.
- [ ] Rodar testes pertinentes, guard antes/depois, builds PWA/native, revisão. Publicar e verificar Windows/web, Android internal e iOS TestFlight na mesma revisão final.

Ledger: branch isolada feat/asset-report-cluster-20261102 baseada em origin/main 7d4be843; 14 blocos intactos. A publicação do relatório anterior continua enquanto este pedido adicional é implementado; a revisão final incluirá ambos.

Validação: 35 testes de interação/regressões e3testesbrowser(320/390/768/1365eCSSPWA), todos aprovados; toque/Tab/Enter/Espaço abrem o ID correto e preservam ações independentes. Guard14 ebuildsPWA/native aprovados. Revisão independente sem bloqueios.
