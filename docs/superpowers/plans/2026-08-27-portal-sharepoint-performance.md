# Portal SharePoint Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o portal progressivo e leve, mantendo o Power Apps apenas como regra e o SharePoint como fonte exclusiva de metadados e dados.

**Architecture:** O shell carregará páginas por importação dinâmica. Galerias buscarão o primeiro lote antes das opções globais, e o catálogo Power Apps terá um runtime compacto separado das evidências de auditoria.

**Tech Stack:** JavaScript ES modules, Microsoft Graph, SharePoint, MSAL, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-27-portal-sharepoint-performance-design.md`

## Global Constraints

- Não criar base duplicada nem persistir registros fora do SharePoint.
- Rótulos, listas, colunas, tipos e choices físicos vêm do SharePoint.
- Power Apps fornece apenas regras de negócio comprovadas.
- Toda mudança comportamental começa com teste falhando.

---

### Task 1: Grafo inicial de módulos

**Files:**
- Modify: `portal/app.js`
- Test: `tests/portal-lazy-routes.test.mjs`

**Interfaces:**
- Consumes: `createRouter`, `pageLifecycle.replace` e fábricas de página existentes.
- Produces: `loadRouteModule(routeName)` e renderização assíncrona cancelável.

- [ ] Escrever teste que falha se `app.js` importar estaticamente páginas pesadas ou `powerapps-ui-contract.js`.
- [ ] Executar o teste e confirmar a falha pelo import estático atual.
- [ ] Substituir imports de página por imports dinâmicos por rota e retirar o contrato Power Apps do módulo inicial.
- [ ] Executar testes de login, roteamento e módulos.
- [ ] Commitar a entrega independente.

### Task 2: Runtime Power Apps compacto

**Files:**
- Modify: `scripts/generate-powerapps-form-controls.mjs`
- Create: `portal/catalog/powerapps-form-runtime.generated.js`
- Modify: `portal/catalog/powerapps-ui-contract.js`
- Test: `tests/powerapps-runtime-size.test.mjs`

**Interfaces:**
- Consumes: resultado estruturado do gerador atual.
- Produces: controles e variantes de runtime sem `evidence` e sem `optionSources[].formula` já estruturada.

- [ ] Escrever teste que exige paridade funcional e tamanho menor que 35% do artefato completo.
- [ ] Executar o teste e confirmar que o runtime ainda não existe.
- [ ] Gerar o artefato compacto preservando defaults necessários e estruturas de regra.
- [ ] Alterar o contrato de runtime para importar o artefato compacto.
- [ ] Executar testes de paridade, campos fechados, defaults e dependências.
- [ ] Commitar a entrega independente.

### Task 3: Primeira página antes dos filtros globais

**Files:**
- Modify: `portal/ui/entity-page.js`
- Test: `tests/entity-progressive-loading.test.mjs`

**Interfaces:**
- Consumes: `repository.getItemsPage` e `repository.getFilterOptionValues`.
- Produces: renderização inicial com `filterOptionsState: loading|ready|error` e atualização posterior sem substituir a galeria.

- [ ] Escrever teste com filtros lentos que exige a primeira renderização antes da conclusão das opções.
- [ ] Executar o teste e confirmar o bloqueio atual.
- [ ] Separar a busca do lote da busca de opções e carregar opções após a renderização.
- [ ] Fazer falha de opções preservar registros e diagnóstico localizado.
- [ ] Executar testes de galeria, paginação, filtros e cancelamento.
- [ ] Commitar a entrega independente.

### Task 4: Metadados visíveis do SharePoint

**Files:**
- Modify: `portal/ui/entity-page.js`
- Modify: `portal/app.js`
- Test: `tests/sharepoint-display-metadata.test.mjs`

**Interfaces:**
- Consumes: `resolveList().displayName` e colunas mapeadas com `displayName`.
- Produces: cabeçalhos, labels e choices exibidos exclusivamente a partir dos metadados SharePoint.

- [ ] Escrever teste com títulos divergentes entre catálogo e SharePoint.
- [ ] Confirmar que a interface ainda mostra o título do catálogo.
- [ ] Usar `list.displayName` e `column.displayName` na galeria e no formulário; aliases permanecem internos.
- [ ] Verificar choices e ComboBoxes contra metadados SharePoint atuais.
- [ ] Executar testes de formulários e galerias.
- [ ] Commitar a entrega independente.

### Task 5: Verificação e publicação

**Files:**
- Modify: `admin.html`
- Modify: versões de cache apenas dos módulos alterados.

**Interfaces:**
- Consumes: entregas das tarefas 1 a 4.
- Produces: portal público com cache renovado e métricas verificadas.

- [ ] Executar a suíte integral com o snapshot Power Apps canônico.
- [ ] Medir bytes do grafo inicial e confirmar ausência do catálogo pesado.
- [ ] Validar dashboard, módulo, galeria e formulário em navegador.
- [ ] Publicar no GitHub Pages e aguardar conclusão.
- [ ] Confirmar os arquivos e identificadores novos no domínio público.
