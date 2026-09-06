# Paridade dos comandos de criação do Power Apps

## Objetivo

Fazer cada linha administrativa do portal oferecer `Lançamento` quando existir uma operação de criação correspondente no Power Apps e uma lista SharePoint resolvida. `Tickets` e `Movimentações` permanecem fora do escopo. `Clientes` participa da varredura.

## Fonte de verdade

- O Power Apps publicado define o comportamento, os formulários e os vínculos entre telas.
- O SharePoint define nomes e identificadores reais das listas e colunas.
- O portal não incorpora o Power Apps e grava diretamente no SharePoint.

## Regras

1. Chamadas `NewForm(FormX)` devem ser reconhecidas em todo o pacote, ainda que o botão e `FormX` estejam em arquivos de tela diferentes.
2. Um formulário com `NewForm` global e `SubmitForm` comprovado é uma criação operacional.
3. Formulários aprovados pelo usuário que existem no Power Apps, mas não possuem `SubmitForm` alcançável no pacote, podem usar um contrato explícito do portal, desde que a entidade e a lista SharePoint sejam inequívocas.
4. Consulta e criação podem apontar para entidades diferentes quando o Power Apps usa uma lista para a galeria e outra para o cadastro.
5. `Cadastro subfamília` usa `CADASTROSUBFAMÍLIA` na galeria e na criação; `SUBFAMÍLIA` não é o destino dessa linha.
6. Nenhuma mutação visual antecede a confirmação da gravação no SharePoint.
7. Rotas de `Tickets` e `Movimentações` não recebem novos comandos.

## Aceitação

- Subfamília exibe `Lançamento` e `Galeria`, ambos funcionais e sem duplicidade.
- Formulários abertos por botões de outras telas são classificados corretamente.
- Clientes volta a ser auditado e mantém a criação disponível.
- Todos os comandos gerados resolvem entidade, contrato de formulário e rota autorizada.
- A suíte automatizada e a auditoria de galerias terminam sem falhas.

