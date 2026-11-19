# Filtros e ficha no relatório de imobilizados

> Executar nesta sessão com executing-plans e test-driven-development.

**Goal:** Reproduzir os filtros da galeria e abrir a ficha compartilhada por ID.
**Architecture:** Ampliar o snapshot com fornecedor, status e depreciar; filtrar antes de calcular totais com Decimal. Reutilizar seletores pesquisáveis e createAssetReportView.
**Tech Stack:** JavaScript, DOM, Graph, Node test, Vite.

## Requisitos
- Filtros: patrimônio, produto imobilizado, filial, fornecedor, status, depreciar e grupo.
- Ao abrir: status ATIVO e depreciar SIM. Atualizar preserva escolhas; reabrir restaura padrões.
- Filtros combinados recalculam linhas, subtotais e indicadores. Resultado vazio mantém os filtros.
- Botão no nome abre ficha/histórico por ID; fechar mantém filtro e rolagem do relatório.
- Preservar precisão financeira, janela de 30 dias, autenticação e cancelamento. Somente leitura.
- Publicar web/Windows, Google Play interno e TestFlight.

## Etapas
- [x] Testes para filtros, padrões, totais, vazio recuperável, metadados e ficha por ID.
- [x] Ampliar data/model/view e encaminhar consulta da ficha pelo controlador de sessão.
- [ ] Testes focados, suíte, trava e builds; layout 320/390/1365 e ficha/gráfico.
- [ ] Revisão, integração e verificação de cada publicação.

## Decisões
Reaproveitar a ficha existente evita divergência com a galeria. Execução e publicação autorizadas sem perguntas. A criação nativa de worktree não retornou; usado git worktree isolado.

## Validação
262 testes focados passaram; builds nativo/PWA e 14 blocos de assinatura verificados. Chromium/WebKit em 320/390/844/1365: seletor real, PDF, ficha, gráfico e retorno passaram. Suíte completa local ainda em execução. Revisão independente sem bloqueadores; corrigido também o limite de datas à meia-noite.
