# Plano: galerias de folha no menu de RH

> **Para execução autônoma:** use `superpowers:executing-plans` ou execute cada item na ordem abaixo. Red/green TDD é obrigatório para cada mudança de comportamento.

**Objetivo:** Incluir atalhos para as galerias somente leitura `IDFOLHA` e `FOLHAPGTO` em uma coluna à direita do menu RH, removendo o avatar lateral apenas nesse menu, com consulta SharePoint autenticada e paginada.

**Arquitetura:** o app identifica o menu RH pelos IDs dos fluxos existentes, adiciona localmente os dois atalhos, e lê as duas listas diretamente pelo repositório Microsoft Graph/SharePoint já usado pelo app. A consulta é somente leitura, pagina os resultados e mantém listas/campos fixos. A view de folha é separada da galeria editável de lançamentos.

**Tecnologias:** JavaScript ES modules, Microsoft Graph, repositório SharePoint existente, DOM, CSS, Node test runner, Vite e Capacitor.

### Tarefa 1 — Consulta SharePoint Graph somente leitura

**Arquivos:** `apps/energetico-mobile/src/chat/orders-gallery-data.js` e `apps/energetico-mobile/tests/orders-gallery-data.test.mjs`.

1. Escrever testes de allowlist, projeção, normalização, paginação e limites.
2. Executar os testes e confirmar a falha antes da implementação.
3. Implementar factory autenticada com `Sites.Read.All`, listas fixas `IDFOLHA`/`FOLHAPGTO`, páginas de no máximo 50 itens e campos projetados.
4. Garantir que a consulta use apenas `resolveList` e `getItemsPage`, sem rota de chat ou operações de escrita.

### Tarefa 2 — UI das duas colunas e view de folha

**Arquivos:** `apps/energetico-mobile/src/ui/chat-view.js`, `apps/energetico-mobile/src/app-controller.js`, `apps/energetico-mobile/src/chat/chat-client.js`, `apps/energetico-mobile/src/ui/hr-payroll-gallery-view.js`, `apps/energetico-mobile/src/ui/hr-payroll-gallery.css` e os testes correspondentes.

1. Escrever testes de regressão do menu com duas colunas/avatar oculto, da abertura para cada lista e do uso do token Graph sem chamar a rota de chat.
2. Rodar testes focados e confirmar RED.
3. Implementar renderização condicional por apresentação sem mudar outros menus; interceptar apenas `action_hr_gallery_idfolha` e `action_hr_gallery_folhapgto`.
4. Conectar a view existente ao repositório paginado Graph com campos definidos, escape de texto, loading/empty/error e botão de retorno/fechamento.
5. Rodar testes focados, depois suite total.

### Tarefa 3 — Validação de release

1. Executar `pnpm test`, `pnpm guard:signature-gestures`, builds web/PWA, verificações iOS e Android.
2. Inspecionar o menu e as galerias em largura mobile e desktop.
3. Publicar web/PWA, Android e iOS conforme pipelines existentes; verificar os resultados de cada destino separadamente.
