# Galeria de Despesas Recorrentes e correção do atalho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o check de baixa agendada quando a VM mantém um fluxo ativo sem poll e adicionar uma galeria somente de consulta para `DESPESASRECORRENTES` ao menu Suprimentos.

**Architecture:** Reutilizar o repositório SharePoint e o visualizador de anexos já integrados ao app. Uma nova fábrica de dados consulta a lista da G19; uma tela isolada fornece filtros, cartões, paginação e detalhes; o controlador gerencia autorização, abertura e ciclo de vida. O contexto do check de baixa passa a consultar o fluxo ativo da sessão quando não há poll corrente.

**Tech Stack:** JavaScript ES modules, Node.js `node:test`, jsdom, SharePoint Graph repository e Vite.

**Spec:** `docs/superpowers/specs/2026-09-23-recurring-expenses-gallery.md` e inventário G19 em `docs/analysis/powerapps-ui-inventory.md` / contrato em `docs/analysis/powerapps-form-field-parity.md`.

## Global Constraints

- Consultar a lista `DESPESASRECORRENTES` pela sessão Microsoft ativa.
- A galeria não altera nem remove registros e não executa `CRIARPREVISAOPGTO`.
- Preservar fluxos em rascunho quando a navegação para a baixa não puder prosseguir com segurança.
- Formatar datas `dd/mm/aaaa`, moeda BRL e recorrências para português.
- Manter web, Android e iOS compatíveis pela interface compartilhada.

## Review Focus

- Estado de fluxo ativo sem poll recente: o check deve ainda entrar em Pendências e alcançar a pergunta de QTD.
- Lista SharePoint ausente ou erro de autorização: não mostrar sucesso nem esconder o erro acionável.
- Respostas com aliases/campos SharePoint variados e anexos sem metadados embutidos: normalizar sem perder os registros.
- Busca, combinação de filtros, página vazia e mudança de tamanho: a lista/paginação não pode ficar inconsistente.
- Toques repetidos, troca de conta e fechamento durante carregamento: nenhuma galeria antiga pode reaparecer.

---

### Task 1: Recuperar o contexto do fluxo ativo no check de pagamento

**Files:**
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`

**Interface:** `currentAssistantPoll()` continua devolvendo apenas o poll atual; `enterScheduledPaymentSelection()` recebe o contexto do poll e usa `currentAssistantPollSnapshot.activeFlow` ou `store.getState().activeFlow` como fallback.

- [x] **Step 1: Escrever teste de regressão antes da implementação**. Preparar `input_continue` com `activeFlow: { id: "payment_provision_attachments", title: "ADICIONAR ANEXOS A UMA PROVISÃO DE PAGAMENTO" }` e resposta sem poll. Fazer a navegação para `portal_confirm_main_menu`, `group_pending`, `pending_payment_settlement` e pagamento `306` devolver a pergunta `DESEJA MANTER O VALOR DE QTD COMO 10?`. Esperar o check retornar `true` e a sequência desses cinco reply IDs.
- [x] **Step 2: Executar somente o teste**. `pnpm exec node --test tests/app-controller.test.mjs`; confirmar falha no erro de fluxo incompatível antes de prosseguir.
- [x] **Step 3: Implementar o fallback mínimo**. Dentro de `enterScheduledPaymentSelection`, resolver `activeFlow` como `currentAssistantPollSnapshot?.activeFlow ?? store.getState().activeFlow`; usar a mesma variável tanto no reconhecimento do poll quanto em `isSuppliesFlowMenu`, `isPortalGroupMenu` e `isPaymentProvisionAttachmentFlow`.
- [x] **Step 4: Executar o teste e a suíte do app**. Esperar o novo caso e regressões de rascunho, poll antigo e fluxo incompatível passarem; comando da suíte: `pnpm test`.

### Task 2: Ler e normalizar dados da G19

**Files:**
- Modify: `apps/energetico-mobile/src/chat/orders-gallery-data.js`
- Create: `apps/energetico-mobile/tests/recurring-expenses-gallery-data.test.mjs`

**Interface:** exportar `createRecurringExpensesGalleryData(options)`, retornando a interface compatível com as outras galerias: `loadSnapshot({ signal })`, `listAttachments(id)` e `downloadAttachment(id, name)`. A consulta resolve os aliases `DESPESASRECORRENTES` e `DESPESAS RECORRENTES` e usa o nome exibido `DESPESASRECORRENTES`.

- [x] **Step 1: Escrever teste vermelho de contrato SharePoint**. Usar um repositório controlado que retorne ID `33`, descrição `TARIFA DE ENERGIA`, valor mensal `144,92`, `RECORRENCIA: "Month"`, lookup de fornecedor, datas e `hasAttachments: true`. Verificar lista resolvida, campos preservados, anexos listados/baixados e aliases exatos.
- [x] **Step 2: Executar teste isolado e observar a falha**. `pnpm exec node --test tests/recurring-expenses-gallery-data.test.mjs` deve falhar por export ausente.
- [x] **Step 3: Adicionar a fábrica**. Encaminhar opções à infraestrutura SharePoint comum com os aliases, nome e código de erro `recurring_expenses_list_missing` específicos.
- [x] **Step 4: Executar teste isolado e suíte**. Confirmar comportamento para lista ausente e resposta de campos/anexos; rodar `pnpm test`.

### Task 3: Criar a galeria de consulta G19

**Files:**
- Create: `apps/energetico-mobile/src/ui/recurring-expenses-gallery-view.js`
- Modify: `apps/energetico-mobile/src/ui/orders-gallery.css`
- Modify: `apps/energetico-mobile/tests/recurring-expenses-gallery-view.test.mjs`

**Interface:** exportar `createRecurringExpensesGallery({ document, data, openMediaCollection, onClose, onHome, now })`, com `open()`, `close()`, `destroy()` e `reload()`; reusar a API dos serviços definida na Task 2.

- [x] **Step 1: Escrever testes de render e formatação**. Com JSDOM e linhas literais, verificar título, filtros G19, cartão 33, valor `144,92` como moeda BRL, `Month` como `Mensal`, datas brasileiras e status.
- [x] **Step 2: Verificar que os testes falham pela tela ausente**. `pnpm exec node --test tests/recurring-expenses-gallery-view.test.mjs`.
- [x] **Step 3: Implementar tela acessível, somente leitura**. Construir cabeçalho/voltar/início, busca, filtros G19, ordenação, tamanhos 10/20/50/100, cartões, detalhe tabular, estado vazio/erro/loading, paginação e anexos encaminhados a `openMediaCollection`. Criar estilos sob classes `.re-*` em `orders-gallery.css` responsivos para mobile e desktop.
- [x] **Step 4: Completar testes de filtros, paginação, anexos e descarte de carregamento**. Verificar filtros combinados sem novas chamadas de rede e que valores de campo são inseridos como texto seguro.
- [x] **Step 5: Executar testes isolados e suíte completa**. `pnpm exec node --test tests/recurring-expenses-gallery-view.test.mjs`; depois `pnpm test`.

### Task 4: Integrar no menu e no controlador

**Files:**
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/styles.css`
- Modify: `apps/energetico-mobile/tests/app-controller.test.mjs`
- Modify: `apps/energetico-mobile/tests/chat-view.test.mjs`

**Interface:** novo reply local `action_recurring_expenses_gallery`; injetar fábricas `recurringExpensesGalleryFactory` e `recurringExpensesGalleryDataFactory`, seguindo o padrão de G28. O botão deve ser o quarto item da coluna Galerias e continuar fora das respostas comuns do fluxo.

- [x] **Step 1: Escrever testes vermelhos de posicionamento e abertura local**. Esperar a ordem `[GALERIA PEDIDOS, GAL. LANÇAMENTOS, GAL. PGTOS PREVISTOS, GAL. DESPESAS RECORRENTES]`, botão renderizado com `data-gallery-button`, quarto row no CSS e um toque em seu ID abrir a tela sem chamar `client.sendText`.
- [x] **Step 2: Executar os testes específicos e observar as falhas**. `pnpm exec node --test tests/chat-view.test.mjs tests/app-controller.test.mjs`.
- [x] **Step 3: Integrar ação, autenticação e ciclo de vida**. Instanciar a galeria/data sob a conta corrente, retomar após consentimento, validar sessão em callbacks, fechar ao trocar/sair da conta e encaminhar anexos ao visualizador compartilhado.
- [x] **Step 4: Executar novamente os testes específicos e a suíte completa**. `pnpm exec node --test tests/chat-view.test.mjs tests/app-controller.test.mjs`; depois `pnpm test`.

### Task 5: Validar distribuição e publicação

**Files:**
- Verificar sem editar os manifests e workflows existentes do app mobile.

- [x] **Step 1: Validar a suíte e build web/PWA**. Executar `pnpm test`, `pnpm build` e `pnpm build:pwa`.
- [x] **Step 2: Validar projetos nativos**. Executar `pnpm ios:verify` e as verificações Android/iOS usadas pelos workflows do repositório.
- [ ] **Step 3: Abrir pull request e aguardar CI verde**. Não misturar alterações alheias do checkout principal.
- [ ] **Step 4: Integrar e publicar nas distribuições configuradas**. Após CI, verificar Pages; produzir/publicar AAB no teste interno e enviar build iOS ao TestFlight pelo fluxo já adotado no repositório; conferir a versão disponibilizada.
