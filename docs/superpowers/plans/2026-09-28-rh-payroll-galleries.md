# Plano: galerias de folha no menu de RH

> **Para execução autônoma:** use `superpowers:executing-plans` ou execute cada item na ordem abaixo. Red/green TDD é obrigatório para cada mudança de comportamento.

**Objetivo:** Incluir atalhos para as galerias somente leitura `IDFOLHA` e `FOLHAPGTO` em uma coluna à direita do menu RH, removendo o avatar lateral apenas nesse menu, com consulta SharePoint autenticada e paginada.

**Arquitetura:** backend adiciona dois IDs fixos ao menu do grupo RH; app identifica o menu por ambos IDs, renderiza duas colunas e intercepta os atalhos sem alterar o estado do fluxo; um novo serviço/view lê campos fixos das duas listas via rota autenticada. A lista/fields nunca vêm do cliente. A view de folha é separada da galeria editável de lançamentos.

**Tecnologias:** Python / SharePoint REST do projeto `whatsapp-sharepoint-oci`; JavaScript ES modules, DOM, CSS, Node test runner, Vite e Capacitor.

### Tarefa 1 — Consulta SharePoint segura no backend

**Arquivos:** `worker/hr_payroll_gallery.py` (novo), `worker/clients.py`, `channel_bridge.py`, `tests/test_hr_payroll_gallery.py` (novo), `tests/test_hr_payroll_gallery_bridge.py` (novo), no projeto externo de backend.

1. Escrever testes de paginação das duas listas, campos fixos, argumentos inválidos, tamanho máximo e ausência de chamadas de escrita.
2. Executar os testes e verificar falha por módulo/comportamento ausente.
3. Implementar serviço com allowlist fixa `IDFOLHA`/`FOLHAPGTO`, autenticação portal existente, páginas de no máximo 50 itens e projeção fixa.
4. Adicionar dispatch `hr_payroll_gallery` no bridge, protegido por `portal_owners.authorize`.
5. Reexecutar testes novos e testes de bridge/galeria existentes.

### Tarefa 2 — UI das duas colunas e view de folha

**Arquivos:** `apps/energetico-mobile/src/ui/chat-view.js`, `apps/energetico-mobile/src/styles.css`, `apps/energetico-mobile/src/app-controller.js`, `apps/energetico-mobile/src/chat/chat-client.js`, novos `hr-payroll-gallery-view.js` e `hr-payroll-gallery.css`, testes `chat-view`, `app-controller`, `chat-client` e novo teste da view.

1. Escrever testes de regressão da apresentação, do menu com duas colunas/avatar oculto, da abertura para cada lista e da chamada autenticada de leitura.
2. Rodar testes focados e confirmar RED.
3. Implementar renderização condicional por apresentação sem mudar outros menus; interceptar apenas `action_hr_gallery_idfolha` e `action_hr_gallery_folhapgto`.
4. Implementar cliente de API e view com campos definidos, escape de texto, paginação, loading/empty/error e botão de retorno/fechamento.
5. Rodar testes focados, depois suite total.

### Tarefa 3 — Menu RH e integração

**Arquivos:** `worker/workflow.py`, `tests/test_hr_payroll_gallery_menu.py` (novo) no backend.

1. Cobrir inclusão apenas no grupo RH, IDs estáveis, metadado de apresentação e preservação dos fluxos atuais.
2. Executar RED, adicionar ações e metadado sem alterar outras telas e validar GREEN.
3. Rodar todas as suítes relacionadas, revisar diff e testar cenários de sessão sem opções e backend indisponível.

### Tarefa 4 — Validação de release

1. Executar `pnpm test`, `pnpm guard:signature-gestures`, builds web/PWA, verificações iOS e Android.
2. Rodar lint/testes backend relevantes e inspecionar o menu e as galerias em largura mobile e desktop.
3. Fazer deploy do backend apenas com comparação de hashes/backups e publicação gradual; validar health, leitura real autorizada e serviços adjacentes.
4. Publicar web/PWA, Android e iOS conforme pipelines existentes; verificar os resultados de cada destino separadamente.
