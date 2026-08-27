# Portal administrativo - paridade Power Apps e SharePoint

## Objetivo

Transformar o portal administrativo da Energetica em uma interface segura e direta para as listas SharePoint, preservando o login Microsoft, sem duplicar dados em Supabase e reproduzindo os fluxos relevantes do Power Apps com uma experiencia web mais clara.

## Regras globais

- SharePoint e a fonte unica dos registros e anexos.
- O login administrativo permanece exclusivamente Microsoft.
- Permissoes de modulo e ACL da lista continuam obrigatorias em cada leitura ou escrita.
- Formularios e galerias exibem apenas campos comprovadamente usados no Power Apps.
- Campos Choice, Lookup e Person sao seletores fechados e preservam a selecao atual na edicao.
- Datas sao exibidas no formato curto pt-BR; valores enviados continuam no tipo exigido pelo SharePoint.
- Mensagens e textos livres preservam a capitalizacao do usuario; demais campos seguem a regra de maiusculas definida no contrato.
- Tickets, movimentacoes de tickets e comunicacoes de clientes deixam de existir na navegacao do novo portal.
- Toda alteracao relevante recebe teste de regressao e validacao visual responsiva.

## Frente 1 - restauracao das fontes

1. Reproduzir as sete fontes indisponiveis no portal publicado.
2. Registrar o erro por fronteira: MSAL, token, Graph, resolucao de site, resolucao de lista, ACL e leitura de itens.
3. Corrigir a causa real sem mascarar falta de permissao ou lista ausente.
4. Exibir diagnostico acionavel por fonte e permitir nova tentativa.

## Frente 2 - contrato Power Apps

1. Usar o manifesto/exportacao do Power Apps para mapear telas, formularios, galerias, filtros e fontes.
2. Criar contrato por entidade com campos de formulario, campos de galeria, filtros, ordenacao, tipos fechados e relacionamentos.
3. Renderizar cadastro e galeria lado a lado em desktop, empilhados em telas menores.
4. Trocar Abrir por Editar e preencher o formulario com os valores existentes.
5. Corrigir pesquisa com foco estavel, espera curta e multiplos termos.
6. Implementar lancamento multiplo nas entidades compativeis, com linhas independentes e resultado por item.

## Frente 3 - navegacao e identidade

1. Menu lateral expansivel e recolhivel com icones e tooltips.
2. Identidade visual distinta por modulo, mantendo componentes e navegacao consistentes.
3. Incorporar logo e variacoes oficiais do mascote com fundo transparente e uso discreto.
4. Diferenciar visualmente cadastro, galeria, editar, salvar e exportar.

## Frente 4 - registros, anexos e auditoria

1. Historico em linha do tempo: criado, editado, anexo adicionado/removido, ator, data e diferencas.
2. Anexos clicaveis, com visualizacao de PDF/imagem, download e navegacao entre arquivos.
3. Exportacao de um registro com os campos visiveis e anexos referenciados.
4. Nova aba de detalhamento por periodo, iniciando no dia atual, com totais de criacoes/edicoes e discriminacao por lista e usuario.

## Frente 5 - paineis

1. Painel inicial com as metricas do HTML Power Apps fornecido.
2. Paineis interativos gratuitos com filtragem cruzada e dados consultados ao vivo no SharePoint.
3. Reproduzir as medidas, filtros e relacionamentos relevantes do Power BI Energetica sem incorporar conteudo publico inseguro.

## Frente 6 - site publico

1. Remover o formulario de cadastro publico e substituir por contato via WhatsApp.
2. Simplificar Trabalhe Conosco para area de atuacao, historico profissional e contato pelo WhatsApp.
3. Quando houver sessao Microsoft no dominio, mostrar nome, e-mail e sair no canto superior direito.

## Entregas

- Publicacoes intermediarias somente apos testes e verificacao visual.
- Cada publicacao recebe um identificador de versao no link de conferencia.
- A entrega final inclui testes executados, fontes efetivamente validadas e eventuais dependencias externas ainda pendentes.
