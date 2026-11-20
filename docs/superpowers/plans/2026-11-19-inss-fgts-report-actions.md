# INSS e FGTS: ações no relatório

**Objetivo:** reduzir a largura do relatório e permitir anexar guias e informar valores diretamente nas células pendentes.

**Decisão:** manter o relatório em paisagem, limitar o painel a 880px e 94% da área útil, reutilizar `loadEditor`/`saveEditor` da galeria para preservar validação, anexos e controle de versão. Quatro fontes usam os ports existentes de câmera, scanner, arquivos e fotos. Nenhuma confirmação de execução adicional: usuário já autorizou implementação e publicação.

- [ ] Testes de comportamento: quatro fontes, cancelamento, erros/repetição, valor brasileiro/zero/inválido, linha correta, leitura tardia e registro atualizado em outra sessão.
- [ ] Implementar diálogos locais no relatório e injetar o seletor nativo pelo controlador. Campos já preenchidos continuam leitura/visualização.
- [ ] Conferir largura e diálogos em telas móveis em paisagem e Windows, build nativo/PWA, suite completa e trava de assinatura.
- [ ] Revisar, integrar e publicar web/Windows, Android interno e TestFlight; verificar cada destino.

**Base:** 959d183. Testes atuais do relatório: 7/7; trava de assinatura: 14 blocos intactos.

**Ruling:** ferramenta nativa de criação de worktree não retornou após vários minutos; criado checkout isolado com git em `2026-11-19/inss-fgts-acoes-relatorio`. Preservar o checkout concorrente da galeria. Nenhuma edição protegida.
