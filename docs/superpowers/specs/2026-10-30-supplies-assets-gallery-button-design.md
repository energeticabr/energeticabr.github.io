# Botão Imobilizados na tela Suprimentos

## Intenção

Na tela de Lançamentos/Suprimentos, mostrar um botão cinza `IMOBILIZADOS` à direita do botão azul `IMOBILIZADOS`. Ao selecionar o botão cinza, abrir a galeria de imobilizados já existente.

## Escopo

- Reutilizar a ação local `action_asset_gallery` e a tela `GALERIA DE IMOBILIZADO` existentes.
- Exibir a ação somente quando a opção principal de imobilizados estiver presente no menu de Suprimentos.
- Preservar a disposição em duas colunas e o estilo cinza padrão de botões de galeria.
- Deduplicar a ação caso o backend já a envie.
- Manter o comportamento idêntico no web/Windows, Android e iOS, pois os três canais usam o mesmo componente.

## Fora de escopo

- Alterar a galeria de imobilizados, seus dados ou cartões.
- Criar uma segunda rota ou uma segunda fonte de dados para imobilizados.
- Alterar os blocos protegidos de gestos de assinatura.

## Abordagens consideradas

1. **Reutilizar `action_asset_gallery` no compositor do menu de Suprimentos (escolhida).** Mantém uma única navegação e uma única galeria, com o menor risco.
2. Criar uma nova ação exclusiva para Suprimentos. Duplicaria roteamento e testes sem benefício visual.
3. Fazer o botão azul abrir diretamente a galeria. Não atende ao pedido de manter dois botões lado a lado.

## Critérios de aceitação

- A linha de imobilizados contém, nesta ordem, `action_supply_fixed_assets` e `action_asset_gallery`.
- O botão da direita mostra `IMOBILIZADOS`, carrega o atributo de botão de galeria e dispara exatamente `action_asset_gallery`.
- O botão não aparece quando não existe opção principal de imobilizados.
- Uma ação `action_asset_gallery` recebida do backend não gera duplicidade.

