# Galeria de Pedidos — especificação

## Objetivo

Adicionar ao fluxo Suprimentos uma Galeria de Pedidos autêntica, baseada na `Screen10` do Power Apps (Galeria6 / lista `NOTASPENDENTES`) e na página pública “Pedidos efetuados”. A galeria de lançamentos atual continua sendo uma opção independente.

## Referências confirmadas

- Power Apps `Screen10` / `Gallery6`, origem `NOTASPENDENTES`.
- Campos e ordem visual observados: ID, filial, fornecedor, forma de pagamento, valor total, observação, data de criação, nota fiscal, data de pagamento/auditoria, quantidade de anexos, criado por e modificado por/data.
- Filtros da Screen10: filial, fornecedor, status, valor total, ID, forma de pagamento e nota fiscal; ordenação por maior ID (padrão), pagamento efetuado, nota fiscal, criação e modificação.
- Página `admin.html#/entity/notas-pendentes`: pesquisa, filial, fornecedor, status, valor total, forma de pagamento e nota fiscal; indicadores de total, anexos, pendentes e editados; registros paginados.

## Experiência

- Em Suprimentos, exibir duas colunas: a coluna esquerda mantém os demais fluxos e o botão **LANÇAMENTOS** cresce verticalmente; a coluna direita contém **GALERIA PEDIDOS** em cima e **GALERIA LANÇAMENTOS** embaixo.
- Os dois botões de galeria mantêm a dimensão atual. Ambos usam cinza-escuro e texto branco. Somente **LANÇAMENTOS** cresce para equilibrar a altura das duas opções da direita.
- A nova galeria é uma tela/diálogo independente, somente leitura, responsiva para Windows Web, Android e iOS.
- Mostrar filtros, totais/indicadores, ordenação e paginação coerentes com as referências. Começar pela maior ID.
- Cards seguem Screen10, com ID, filial, fornecedor, forma de pagamento, total, observações, nota fiscal, estado de auditoria, datas, autor/modificador e acesso aos anexos. Datas são apresentadas como `dd/mm/aaaa`.
- Abrir detalhes mostra os dados do pedido organizados em tabela; anexos do SharePoint abrem no visualizador compartilhado, com navegação entre os arquivos do pedido.

## Dados e segurança

- Consultar `NOTASPENDENTES` diretamente no SharePoint com o token delegado da conta Microsoft autenticada, respeitando permissões ACL do próprio SharePoint.
- O login inicial solicita apenas as permissões básicas do app. `Sites.Read.All` e o escopo REST `AllSites.Read` do SharePoint são consentidos incrementalmente ao abrir Pedidos, mantendo a mesma conta Microsoft ativa.
- Consultar anexos pela API autenticada do SharePoint. Nunca enviar token ao serviço remoto do chatbot nem depender de caminhos de disco da VM.
- Leitura somente. Não implementar edição, exclusão, auditoria/postagem ou alteração de pedidos.
- Erros de autorização/rede devem aparecer na própria galeria com orientação para tentar novamente; não exibir tokens, URLs internas ou stack traces.

## Fora do escopo

- `G28 - HISTÓRICO PAG PREVISTO` não é a Galeria de Pedidos e não orienta os campos dessa tela.
- Alterar ou publicar o app Power Apps, mudar permissões SharePoint ou alterar o fluxo da Galeria de Lançamentos.

## Critérios de aceite

1. Suprimentos mostra os dois acessos às galerias no arranjo e nas cores especificadas.
2. A Galeria de Pedidos carrega registros reais da lista `NOTASPENDENTES` somente após autenticação.
3. Filtros, ordenação, indicadores, paginação e datas funcionam com campos opcionais/valores de lookup.
4. O botão de anexos abre arquivos SharePoint do item e permite avançar/voltar entre eles.
5. Detalhes são somente leitura e exibidos em tabela responsiva.
6. Testes cobrem acesso, filtros, paginação, anexos, escape de texto, datas e preservação da galeria de lançamentos.
7. Testes/builds Android, iOS e Web/Windows passam; deploy segue os workflows existentes.
