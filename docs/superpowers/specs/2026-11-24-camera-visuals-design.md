# Visuais de câmeras

## Objetivo

Permitir que cada usuário salve conjuntos nomeados de câmeras e abra um conjunto inteiro com um toque, como grupos predefinidos.

## Escopo

- Adicionar as abas **Câmeras** e **Visuais** à tela atual.
- Em **Visuais**, oferecer **Criar visual**; a criação usa a lista existente com seleção de até oito câmeras e, depois, pede um nome.
- Salvar nome e IDs estáveis das câmeras no armazenamento local, com chave separada por conta, seguindo o padrão já usado para nomes de câmeras.
- Mostrar os visuais salvos e abrir as câmeras disponíveis do visual pela grade ao vivo já existente, identificando o player com o nome do visual.
- Se nenhum membro do visual estiver disponível, manter a tela aberta e informar o motivo; se apenas alguns estiverem disponíveis, abrir os que restarem e informar quantos faltaram em um aviso visível no player.
- Manter a experiência responsiva nos apps Capacitor de iOS/Android e no PWA usado no Windows.

## Fora de escopo

- Sincronização de visuais entre dispositivos, pois o fluxo atual salva preferências de câmera localmente e não possui serviço de backend para esse dado.
- Editar ou excluir visuais depois de criados.
- Alterar limites, codec, conexão ou controles do player.

## Abordagens consideradas

1. **Armazenamento local por conta e reaproveitamento da tela e do player atuais — escolhida.** Preserva o padrão existente de preferências locais, mantém os IDs das câmeras separados por conta e abre a grade atual, cujo limite é oito.
2. **Persistência em backend sincronizada entre dispositivos.** Exigiria novo contrato de API, autorização, migração e tratamento de concorrência; excede a necessidade imediata e não há hoje um repositório para visuais.
3. **Implementar um segundo visualizador para cada grupo.** Duplicaria reprodução, retomada e orientação que já funcionam na grade atual.

## Restrições e decisões

- A tela deve continuar reconhecendo nomes personalizados de câmera e identificar cada membro por `channel.id`, não pelo texto exibido.
- A chave de persistência deve incluir o `accountKey`; falha de armazenamento não pode mostrar o visual como salvo.
- O limite de oito deve ser visível na seleção e corresponder ao `GRID_LIMIT` existente.
- A lista de visuais deve acomodar estados vazio, dado local inválido e câmera ausente sem interromper a tela.
- A trava dos gestos de assinatura do app móvel é protegida e não pode ser tocada.

## Critério de aceite

O usuário consegue selecionar câmeras, dar um nome e ver o visual em **Visuais**; tocar nesse visual abre as câmeras membro disponíveis em uma única grade identificada pelo nome do visual, informa membros ausentes e persiste ao reabrir o app na mesma instalação e conta.
