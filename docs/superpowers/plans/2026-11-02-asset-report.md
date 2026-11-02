# Relatório do imobilizado Implementation Plan

> Execução inline com superpowers:executing-plans; revisão independente do conjunto ao final.

**Goal:** Abrir cadastro e histórico completo do bem selecionado nas duas galerias de imobilizados.
**Architecture:** Serviço de leitura por ID e metadados, modal acessível com rolagem própria, integração da fábrica de dados e conteúdo dos cartões. Sem mutações de SharePoint/fluxo.
**Tech Stack:** JavaScript, SharePoint repository, DOM/CSS, node:test, JSDOM, Chrome headless existente.
**Spec:** docs/superpowers/specs/2026-11-02-asset-report-design.md.

## Constraints and review focus

- Reutilizar o worktree isolado existente, branch feat/relatorio-imobilizado-20261102 a partir de origin/main; 14 blocos protegidos intactos antes de editar.
- ID do histórico nunca equivale ao ID do bem. Histórico somente por ID IMOBILIZADO numérico comprovado em metadados.
- Metadados de Title renomeado podem conter LinkTitle computado; não tratar espelhos como colunas reais.
- Falha na segunda página, cursor cíclico e resposta de outro bem não viram histórico vazio ou total parcial.
- Fechar/trocar/atualizar/logout cancela; tentativa nova invalida resposta anterior e preserva contexto da galeria.
- Sem HTML legado no relatório e sem criar ou alterar registros.

## Tasks

1. **Serviço** — criar src/chat/asset-report-data.js e tests/asset-report-data.test.mjs. `createAssetReportData({repository, siteKey, assertSession}).loadAssetReport(id,{signal,onProgress})` retorna `{assetId,asset:{id,fields,details},history,historyTotal}`. RED: cadastro por ID, 275 linhas paginadas só do bem, valores reais com Decimal, vínculos vazios, metadados e falhas/cancelamento. Implementar e executar GREEN.
2. **Relatório e integração** — criar src/ui/asset-report-view.js e CSS; modificar registration-gallery-data.js e registration-gallery-view.js. `createAssetReportView({document,host,background,loadReport,resolveTrigger,timeoutMs})` expõe open/close/destroy. RED: clique em ambas as galerias, ID correto, campos acima do histórico, moeda/data, retorno, anexos/editar independentes, retry/stale/timeout/teclado. Implementar GREEN.
3. **Layout e publicação** — fixture fictícia e teste browser 320/390/1365px com nomes longos/linhas/IDs grandes, screenshots. Rodar regressões pertinentes, guard e builds. Revisão independente, corrigir achados, PR/merge com checks obrigatórios e acompanhar pipelines automáticos da mesma revisão. Verificar site servido, Play internal e TestFlight separadamente.

## Ledger

- Iniciado após examinar as duas galerias, serviços de metadados/paginação e padrão de modal existente. Usuário dispensou perguntas; execução e publicação já autorizadas.
- [x] Serviço RED/GREEN
- [x] Relatório e integração RED/GREEN
- [x] Layout/build/guard/revisão
- [ ] Publicações verificadas

- Revisão: corrigidos P2 de foco Tab e cache de import rejeitado; ambos reproduzidos RED e corrigidos GREEN. 12 testes data/view e 6 cenários browser aprovados. Builds PWA/native e guard intacto. Leitura real via conector conferiu bem96/histórico275, 22 campos cadastrais, total146,10, zero mutações. Somente metadados e registros salvos fora do git em evidence/asset-report.

- Validações finais: 62 testes de imobilizados e 137 regressões gerais, ambos com zero falhas; PWA/native concluídos, 14 blocos intactos. Revisão confirmou13/13testesfocados e aprovou. Browser real confirmouToque/Tab/Enter/Escape/retorno em6cenários. Guarda adicional rejeita vínculo ausente e nomes físicos inválidos, sem relatório parcial.
