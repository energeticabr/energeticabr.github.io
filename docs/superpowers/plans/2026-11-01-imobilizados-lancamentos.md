# Imobilizados: menu e lançamentos

> **For agentic workers:** Execute inline with superpowers:executing-plans and test-driven-development. Review the branch before publication.

**Goal:** O botão cinza IMOBILIZADOS abre CADASTROS IMOBILIZADOS e, abaixo, LANÇAMENTOS IMOBILIZADOS; a primeira opção conserva a galeria e a segunda consulta a lista nova.

**Architecture:** Reutilizar o ciclo de vida das galerias do controlador e o leitor paginado/galeria nativa existente. Criar apenas o seletor intermediário; adicionar um modelo somente leitura para LANCAMENTOSIMOBILIZADOS. A tela intermediária não consulta nem altera dados.

**Tech Stack:** JavaScript, DOM, Microsoft Graph, Vite/Capacitor, node:test/jsdom.

**Spec:** A solicitação do usuário nesta conversa; seis campos históricos e ID IMOBILIZADO, lista f0f13292-f28c-4c09-8060-4d4af4664730 no site pessoal. Nenhuma alteração no fluxo DEPRECIACAO ou na carga.

## Global Constraints

- Botão azul e cadastro existente continuam funcionando.
- Botões na ordem CADASTROS IMOBILIZADOS / LANÇAMENTOS IMOBILIZADOS.
- Carregar todas as páginas e conservar nomes vazios no histórico.
- Percentuais armazenados como frações; moeda BRL; datas de depreciação sem deslocamento.
- Não alterar blocos protegidos de assinatura.
- Publicar e conferir web/Windows, Google Play internal e TestFlight.

## Review Focus

- Navegação de volta da galeria aberta pelo menu retorna ao menu intermediário; acesso direto conserva seu comportamento.
- Cliques duplicados, encerramento de sessão e fábrica atrasada não abrem telas obsoletas.
- Nomes ausentes continuam identificáveis pelo ID do imobilizado.
- Busca, filtros, carregamento completo e formatação usam os campos reais da nova lista.
- A galeria somente leitura não oferece criação/edição/exclusão.

## Task 1: Menu e navegação

- [x] Escrever e executar testes que falhem: clique cinza abre o seletor; ambas opções levam à fonte correta; voltar/sessão e abertura duplicada.
- [x] Criar src/ui/asset-gallery-menu.js e CSS; integrar no ciclo de vida registrationGalleries em app-controller.js.
- [x] Trocar somente a ação sintética cinza de Suprimentos em chat-view.js, mantendo os pares de cadastro.
- [x] Adicionar retorno opcional por abertura em registration-gallery-view.js.

## Task 2: Fonte e galeria

- [x] Testar falha para novo kind assetLaunches: leitura de múltiplas páginas, campos codificados reais, valores zero, busca/filtros e ausência de mutações.
- [x] Adicionar modelo assetLaunches em registration-gallery-data.js com a nova lista, seis campos e ID IMOBILIZADO.
- [x] Validar layout fictício a 320/390/1365 px e retorno ao seletor.

## Task 3: Verificação e publicação

- [ ] Guard de assinatura, testes focados, suíte completa e build/PWA.
- [ ] Revisão do diff; corrigir problemas relevantes e testar.
- [ ] Commit/PR/merge e acompanhar Pages, Android internal e TestFlight para a revisão correta.
- [ ] Verificar assets públicos e os 275 registros pela fonte live; registrar evidências locais.

## Progress

- Recon: base origin/main 3510e6fa; novo worktree isolado nesta pasta. Native worktree tool não aceita sourceRoot fora do workspace, usado git worktree local.
- Prévia de execução: manter tudo dentro do escopo pedido; aprovação de desenho e publicação já autorizadas pelas instruções do usuário e AGENTS.md.
- Revisão independente encontrou duas disputas de navegação (consulta anterior sobrepondo o menu e reabertura após Voltar). Ambas reproduzidas por testes RED e corrigidas invalidando aberturas anteriores na entrada do menu. 35 testes focados GREEN; layout e builds nativo/PWA passaram. Nova leitura live confirmou 275 registros/47 imobilizados, todos vinculados por ID.
