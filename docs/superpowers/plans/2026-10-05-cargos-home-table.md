# Tabela de cargos na tela inicial

Objetivo: acrescentar à direita do menu inicial o mascote fornecido, com fundo vermelho claro, abrindo uma tela que consulta a lista pessoal CARGOS indicada pelo usuário.

Arquitetura: leitor SharePoint da sessão existente; modelo com grupos e totais monetários; tela inteira com tabela acessível e rolagem horizontal no telefone; integração ao ciclo de vida e autenticação do controlador. Valores nunca são incluídos no código ou enviados para outra base.

Tecnologias: JavaScript, Decimal.js, SharePoint repository, DOM/CSS, node:test/JSDOM, Vite e fluxos de publicação existentes.

Especificação: grupos Servente de Pedreiro I/II/III, Pedreiro I/II/III, Mestre de Obras; colunas Cargo, Salário, Vale alimentação, Prêmio, Vale transporte e Total. Fonte: lista CARGOS pessoal de Bernardo. Preservar todos os blocos protegidos de assinatura.

## Execução

- [x] Modelo e leitor: testes de moeda, colunas reais, paginação completa, referências e erros; implementar e executar.
- [x] Tela: testes de grupos, totais, atualização, fechamento e cancelamento de consultas; implementar layout inteiro responsivo.
- [x] Menu/controlador: testar atalho, autenticação, limpeza da sessão e abertura; integrar o asset fornecido sem edição.
- [ ] Revisão e publicação: testes, builds, trava de gestos, revisão independente, PR e publicação web/Android interno/TestFlight; verificar resultado no app.

## Foco da revisão

Não expor valores na sessão seguinte; não publicar totais de páginas incompletas ou valores inválidos; mapear nomes internos a partir dos metadados; não mostrar referência futura como atual; manter atalhos antigos e toque no telefone; preservar gestos protegidos.

## Verificação

Leitor/modelo/tela: teste observado falhando sem os módulos, depois 4/4 passaram. Menu/controlador: 3/3 testes RED→GREEN. Chrome real: 320/390/768/1365 px e PWA, grupos/total/rolagem com Cargo fixo; descoberta de importação CSS ausente no PWA reproduzida e corrigida. Builds nativo e PWA aprovados. Trava: 14 blocos intactos. Revisão independente em contexto novo: sem achados. Valores reais confirmados visualmente no SharePoint; publicação e comprovação ao vivo pendentes.

Suíte completa: 2029/2029 aprovados, sem skips, em 148,7 segundos.
