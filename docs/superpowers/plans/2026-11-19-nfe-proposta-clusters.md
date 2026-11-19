# Clusters da proposta fiscal

**Goal:** destacar produto, etapa, quantidade com unidade, preço unitário e total abaixo de cada título fiscal; ampliar fornecedor e filial.

**Architecture:** manter os controles e cálculos existentes; alterar somente a apresentação em `nfe-proposal-view.js` e `nfe-report.css`, compartilhada por lançamentos e provisões. Resumos com clusters azuis para produto/etapa e clusters claros para valores, texto completo com quebra. Datas em linha própria. Cabeçalho com duas colunas largas e fonte menor nos seletores.

**Autorização:** usuário determinou execução sem perguntas e publicação Android, iOS e Windows. Implementação direta nesta worktree.

- [x] Adaptar a verificação existente de unidade fiscal ao resumo com clusters; confirmar falha antes da mudança.
- [x] Atualizar resumo e CSS; preservar seleção, limpeza, unidade fiscal e cálculo.
- [x] Executar testes focados e layout real 320, 390, 844 e Windows; inspecionar capturas, overflow e largura dos seletores. Executar guard e builds.
- [ ] Revisar diff, integrar via PR e confirmar Pages, Play interno e TestFlight na revisão publicada.

**Review focus:** nomes extensos, valores inválidos durante edição, unidade da nota diferente do cadastro, atualização dos clusters ao editar, altura limitada do relatório horizontal.

**Verificação:** 74 testes focados passaram; guard preservou 14 blocos; builds web/PWA, secrets e ios:verify passaram. Layout em Chrome 320×568, 390×844, 844×390 e 1365×900 passou, capturas de cabeçalho e clusters inspecionadas. Revisão independente não encontrou defeitos bloqueadores e conferiu eventos de edição/limpeza e unidade fiscal. Teste de browser resolve ESMs instaladas explicitamente para contornar falha Vite/pnpm em symlinks no Windows. Suíte completa local apresentou falhas de fixtures fora do escopo; CI Linux será conferido antes da integração.
