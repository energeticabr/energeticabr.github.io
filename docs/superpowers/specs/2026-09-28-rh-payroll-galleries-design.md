# Galerias de folha no menu de Recursos Humanos

## Objetivo

Na tela inicial de Recursos Humanos, manter os fluxos atuais em uma coluna à esquerda e apresentar dois atalhos de consulta em uma segunda coluna à direita: `GALERIA IDFOLHA` e `GALERIA FOLHA PGTO`. Ocultar o avatar Energético à esquerda apenas nessa mensagem de menu para liberar largura útil.

## Comportamento

- As ações atuais do menu de RH continuam com os mesmos identificadores, texto e fluxo.
- A mensagem do menu RH recebe uma apresentação específica, sem afetar outros menus. Em telas estreitas, ambas as colunas permanecem utilizáveis, os rótulos quebram linha e não há rolagem horizontal.
- Os dois atalhos abrem uma galeria nativa do app sem enviar uma resposta de fluxo para o backend; fechar retorna ao chat/menu existente.
- `IDFOLHA` exibe ID, mês de referência e fornecedor.
- `FOLHAPGTO` exibe ID, fornecedor, tipo de pagamento, valor unitário, quantidade, data e ID da folha.
- As galerias são somente leitura e consultam as listas fixas `IDFOLHA` e `FOLHAPGTO` no site pessoal já configurado no app. A interface não aceita nomes de lista, URL ou campos escolhidos pelo usuário.
- A consulta usa o token Microsoft Graph já empregado pelas galerias SharePoint do app (`Sites.Read.All`) e paginação com `nextLink`; cada página tem no máximo 50 itens.
- Estados visuais incluem carregamento, vazio, erro recuperável, paginação e fechamento. Dados apresentados são escapados como texto.

## Arquitetura

1. O app identifica o menu de RH pelos IDs dos fluxos existentes e insere localmente dois atalhos fixos; assim não depende de publicar novas opções no backend.
2. O app intercepta os atalhos sem responder ao fluxo. O controlador cria a consulta Graph com a sessão Microsoft ativa e usa o repositório SharePoint compartilhado já existente.
3. A consulta tem allowlist local fixa para `IDFOLHA` e `FOLHAPGTO`, projeta os campos definidos para cada galeria e segue `nextLink` de forma paginada. Nenhuma rota nova de chat/backend é chamada.

## Segurança e compatibilidade

- A consulta Graph usada por estas galerias só chama leitura de lista/itens; não há escrita, upload ou exclusão.
- O cliente valida as listas, a página e o tamanho e projeta um conjunto fixo de campos. O acesso efetivo continua limitado às permissões SharePoint da conta Microsoft conectada.
- Erros de autenticação ou SharePoint são apresentados como estado recuperável na UI.
- A mudança permanece isolada da árvore de trabalho RHID preexistente; arquivos alheios a este recurso não serão mesclados.
- A UI é compartilhada pelo build web/PWA, Android e iOS do app.

## Verificação

- Testes da consulta para allowlist, projeção, paginação, limite de tamanho e rejeição de listas/parâmetros desconhecidos.
- Testes do controlador para token Graph autenticado e ausência de chamadas à rota antiga do backend.
- Testes da view/controller para ambos os atalhos, avatar/colunas, conteúdo, loading/empty/error/paginação e retorno ao chat sem postar mensagem.
- Rodar teste completo do app, trava de gestos, builds web e PWA, verificações iOS/Android e inspeção visual responsiva.
- Publicar apenas após confirmar o estado dos pipelines e publicar a versão para os destinos suportados.
