# Galerias de folha no menu de Recursos Humanos

## Objetivo

Na tela inicial de Recursos Humanos, manter os fluxos atuais em uma coluna à esquerda e apresentar dois atalhos de consulta em uma segunda coluna à direita: `GALERIA IDFOLHA` e `GALERIA FOLHA PGTO`. Ocultar o avatar Energético à esquerda apenas nessa mensagem de menu para liberar largura útil.

## Comportamento

- As ações atuais do menu de RH continuam com os mesmos identificadores, texto e fluxo.
- A mensagem do menu RH recebe uma apresentação específica, sem afetar outros menus. Em telas estreitas, ambas as colunas permanecem utilizáveis, os rótulos quebram linha e não há rolagem horizontal.
- Os dois atalhos abrem uma galeria nativa do app sem enviar uma resposta de fluxo para o backend; fechar retorna ao chat/menu existente.
- `IDFOLHA` exibe ID, mês de referência e fornecedor.
- `FOLHAPGTO` exibe ID, fornecedor, tipo de pagamento, valor unitário, quantidade, data e ID da folha.
- As galerias são estritamente somente leitura. A API recebe somente o identificador lógico da galeria, número da página e tamanho limitado; lista e colunas são definidas no servidor.
- A consulta usa a autenticação existente do portal, uma allowlist fixa de duas listas, campos explícitos e paginação SharePoint. Não aceita nome de lista, URL, OData ou campos arbitrários do cliente.
- Estados visuais incluem carregamento, vazio, erro recuperável, paginação e fechamento. Dados apresentados são escapados como texto.

## Arquitetura

1. Backend `WorkflowEngine` adiciona dois itens de menu de galeria apenas ao grupo de RH. O app identifica essa mensagem pela presença simultânea dos dois IDs reservados.
2. O app divide opções existentes e atalhos por seus IDs reservados, oculta o avatar somente para essa apresentação e intercepta os dois cliques.
3. O app consulta `action: "hr_payroll_gallery"` no endpoint autenticado `/portal/chat` e abre uma nova view isolada, sem reutilizar a galeria editável de lançamentos.
4. O bridge autoriza a identidade com o mesmo mecanismo do portal e delega a um serviço de leitura que só conhece `IDFOLHA` e `FOLHAPGTO`.
5. O SharePoint usa paginação por `nextLink` recebido da resposta anterior, encapsulado como cursor opaco e validado para o mesmo site/lista; cada chamada lê somente uma página de até 50 itens.

## Segurança e compatibilidade

- Não há operação de escrita, upload, exclusão ou edição nessa API/view.
- O serviço valida lista lógica, página e tamanho e projeta uma lista fixa de campos.
- Erros do SharePoint são convertidos em mensagens seguras para a UI.
- A mudança permanece isolada da árvore de trabalho RHID preexistente; arquivos alheios a este recurso não serão mesclados.
- A UI é compartilhada pelo build web/PWA, Android e iOS do app.

## Verificação

- Testes backend para autorização, allowlist, projeção, paginação, limite de tamanho e rejeição de listas/operações desconhecidas.
- Testes do cliente para payload restrito e autenticação da chamada.
- Testes da view/controller para ambos os atalhos, avatar/colunas, conteúdo, loading/empty/error/paginação e retorno ao chat sem postar mensagem.
- Rodar teste completo do app, trava de gestos, builds web e PWA, verificações iOS/Android e inspeção visual responsiva.
- Publicar apenas após confirmar o estado dos pipelines e publicar a versão para os destinos suportados.
