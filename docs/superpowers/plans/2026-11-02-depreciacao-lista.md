# Histórico diário de depreciação na lista

> Executar inline com testes antes da implementação e revisão independente antes de publicar.

**Goal:** Substituir o acréscimo de HTML no cadastro IMOBILIZADOS por um registro em LANCAMENTOSIMOBILIZADOS, ligado ao ID real criado em LANCAMENTOS.

**Architecture:** Transformação restrita da definição live do fluxo DEPRECIACAO (1d482b08-3fe4-468f-9db9-3de1866c104e). Acrescentar coluna numérica opcional IDLANCAMENTO, exibida como ID LANÇAMENTO. Conservar cronograma, seleção, cálculos, lançamento financeiro, saldo e próxima data; remover exclusivamente item/HTML do Update_item. Criar histórico após o lançamento e antes da atualização do bem. Preservar o HTML legado e os 275 registros carregados; sem inferir vínculos históricos.

**Tech Stack:** Power Automate/WDL, SharePoint, PowerShell/MSAL já autorizado, JavaScript/node:test e galeria existente.

**Spec:** Pedido do usuário nesta conversa: rotina diária, mesmos lançamentos financeiros e edições de cadastro, histórico em nova lista e ID financeiro em cada linha nova.

## Constraints and review focus

- Escritas remotas limitadas à nova coluna/lista, definição do fluxo alvo e execução normal autorizada.
- Backup antes de alterar; comparar definição antes de PATCH para não sobrescrever edição concorrente.
- A linha histórica usa percentual fracionário, data da competência e os mesmos centavos exibidos pelo HTML anterior.
- ID IMOBILIZADO vem do cadastro; ID LANÇAMENTO vem da resposta Create_item.body.ID.
- Falha na criação do histórico impede Update_item; não testar criando despesas fictícias em LANCAMENTOS.
- Nenhum teste dispara depreciação antecipada de item real. Validar WDL com dados fictícios/ações Compose e conferir definição publicada e schema live.
- Campo novo visível na galeria, incluindo registros legados sem vínculo preenchido.
- Publicar web/Windows, Android interno e TestFlight para a atualização da galeria.

## Tasks

- [x] Tests RED para transformação restrita, ordem das ações, origem do ID, moeda/percentual e idempotência da transformação.
- [x] Implementar builder e script de implantação com preflight/backup/releitura; criar coluna e publicar definição validada.
- [x] Validar expressões em execução isolada somente leitura e assegurar zero mudanças nos cadastros, HTMLs e históricos durante a implantação.
- [x] Tests RED/GREEN do ID LANÇAMENTO na galeria; checks focados, guard de assinatura e builds.
- [ ] Revisão; PR/merge; conferir CI e publicações da mesma revisão.

## Status

- Snapshot live salvo fora do git em evidence/depreciation-flow/flow-before.json. Fluxo ativo, recorrência diária às 7h de São Paulo; nenhuma execução pendente. Lista histórica com 275 linhas. Há um bem com competência antiga ainda pendente, portanto não executar o fluxo de produção antecipadamente apenas para teste.

- Fluxo publicado e relido em 2026-11-02T04:20:33Z: ativo, cronograma e criação financeira idênticos; 47 cadastros e 275 históricos preservados. Probe real: 3 casos/27 checks/zero escritas externas. Revisão independente concluída; aprovação vinculada ao hash exato.
