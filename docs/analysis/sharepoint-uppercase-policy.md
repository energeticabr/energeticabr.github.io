# Politica de caixa alta no SharePoint

## Regra

O payload de cadastro e edicao deriva a normalizacao do tipo fisico informado pelo SharePoint. Colunas `text` e `textarea`, inclusive multiline, sao aparadas e enviadas em caixa alta com locale `pt-BR`.

A unica excecao e um nome interno de coluna presente exatamente em `entity.messageFields`. Essas mensagens livres continuam sendo aparadas, mas preservam a caixa digitada. `uppercaseFields` permanece no catalogo por compatibilidade, mas nao controla mais o payload.

Tipos estruturados nao participam da conversao:

- `Choice` preserva o valor declarado pela lista.
- `Lookup` e `Person` continuam sendo enviados como `NomeDoCampoLookupId`.
- numeros, moeda, booleanos, datas e colunas calculadas mantem seus fluxos de conversao ou somente leitura.

Assim, a regra vale automaticamente para todas as entidades que usam `mapSharePointColumns` e `validateFormValues`, sem uma lista manual de campos em caixa alta. Os testes cobrem campos reais de `lancamentos`, incluindo multiline, e de `diarios-de-obras`.

## Ambiguidades conhecidas

A classificacao de mensagem e exata e depende do nome interno recebido do SharePoint. Em `diarios-de-obras`, o catalogo atual declara `DESCRICAO` e `OBSERVACOES` em `messageFields`, enquanto o inventario Power Apps registra nomes fisicos diferentes, como `ATIVIDADESEXECUTADAS`, `OCORR_x00ca_NCIASEIMPREVISTOS` e `DESCRI_x00c7__x00c3_O`. Nao ha evidencia suficiente para equiparar esses nomes. Portanto, os campos fisicos nao declarados exatamente sao tratados como cadastro textual e enviados em caixa alta; nao se alega que estejam cobertos pela excecao de mensagem livre.

Alguns seletores Power Apps podem gravar em uma coluna SharePoint fisicamente textual. O mapeador nao consegue distingui-los de texto livre apenas pelo esquema da coluna, entao eles seguem a regra de caixa alta. A protecao contra conversao incorreta e garantida para tipos SharePoint nativos `Choice`, `Lookup` e `Person`.
