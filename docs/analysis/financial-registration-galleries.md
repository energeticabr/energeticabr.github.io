# Galerias dos cadastros financeiros

O submenu FINANCEIRO → CADASTROS mostra cada cadastro à esquerda e sua
galeria à direita, usando os mesmos componentes das galerias existentes.

| Galeria | Base SharePoint | Modelo do cadastro |
| --- | --- | --- |
| Investimentos | CADASTRO INVESTIMENTO | Screen15 / Form45 |
| Instituições | INSTITUICAOEMISSORA | Screen16 / Form54 |
| Tipos de investimento | CADASTROTIPOINVESTIMENTO | Screen16_1 / Form55 |
| Rentabilidade | RENTABILIDADE | Screen16_2 / Form53 |
| Tributação | TRIBUTAÇÃO | Screen16_3 / Form53_1 |

Cada galeria lê todas as páginas da base com a sessão Microsoft do usuário,
mostra os campos de negócio e a auditoria padrão, e oferece pesquisa, filtros,
atualização, edição e o atalho + para o fluxo de cadastro já publicado na VM.
A edição usa os metadados atuais da lista e apenas os campos dos modelos acima;
Título, usado para idempotência, fica fora da edição.

Instituição do investimento usa exclusivamente os valores da base
INSTITUICAOEMISSORA. STATUS é uma seleção ATIVO/INATIVO em Instituições,
Tipos de investimento e Rentabilidade; em Tributação permanece texto conforme
Form53_1. TIPO usa RENDA FIXA/RENDA VARIÁVEL na base de tipos de investimento.
As variantes antigas de edição de rentabilidade usam outro esquema, por isso
a nova galeria usa os dois campos comprovados do Form53 com os metadados atuais.

As leituras e as prévias dos testes não cadastram registros financeiros reais.
Os testes cobrem pareamento, roteamento, criação, pesquisa, filtros, campos
editáveis e rejeição de instituição inventada antes da escrita.
