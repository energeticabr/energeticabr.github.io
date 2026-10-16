# Anexos e títulos nos editores das galerias

## Objetivo

Nos formulários de edição das galerias, mostrar os anexos existentes e permitir marcar cada um para exclusão com X, desfazer a marcação antes de salvar e aplicar a exclusão somente após SUBMETER. No editor de programação de pagamentos, o cluster Anexos vem após DATA EXECUÇÃO AGENDAMENTO. Os títulos dos campos desses formulários usam fundo vermelho e texto branco, como no Power Apps.

## Fluxo e segurança

- O formulário compartilhado carrega os anexos da mesma lista e do mesmo item cujo contexto de edição foi aberto. A falha de leitura é mostrada sem inventar lista vazia; os campos podem continuar editáveis, mas anexos indisponíveis não podem ser excluídos.
- O X altera somente o rascunho local. A linha marcada continua visível, com ação Restaurar; Cancelar descarta as marcas. A lista exibe nomes de arquivos como texto, sem HTML de origem externa.
- SUBMETER valida campos e o conjunto de anexos antes de gravar. Os campos são gravados primeiro; operações de anexo restantes são verificadas e aplicadas sem repetir um campo já gravado em retentativa. Falhas parciais permanecem explícitas e retomáveis, sem declarar conclusão falsa.
- A folha de pagamento mantém a regra própria de recibo para STATUS INATIVO e ganha marcação/restauração de anexos existentes. O editor de lançamentos, que não usa o formulário compartilhado, preserva seu fluxo de revisão e aplica exclusões de anexos somente após confirmação.
- As mudanças de cor ficam limitadas aos formulários de edição de galerias, não aos relatórios nem aos campos de leitura.

## Verificação

Testes de rascunho, cancelamento, restauração, exclusão no submit, falhas parciais e posicionamento do cluster; teste visual de rótulos em celular e desktop; suíte completa, build web/PWA e trava de gestos. Publicar a mesma revisão em web, Android interno e TestFlight.
