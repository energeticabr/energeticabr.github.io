# Tarefas delegadas em Pendências

## Objetivo

Adicionar ao fluxo de **Pendências** uma galeria de tarefas delegadas ainda não concluídas. A galeria deve consultar a lista `TAREFASDELEGADAS`, permitir localizar tarefas por texto, ordenar os itens por arraste e concluir uma tarefa com um check.

## Experiência do usuário

- A opção **📋 TAREFAS DELEGADAS (N)** aparece no menu de Pendências somente quando existir pelo menos um item cujo status seja diferente de `CONCLUÍDO`.
- Ao abrir a opção, o app exibe uma galeria vertical com campo de busca, instrução curta e um cartão por tarefa.
- Cada cartão mostra a tarefa e os dados úteis disponíveis: responsável, prioridade, prazo, filial/associação e status.
- O usuário pode tocar e arrastar um cartão para cima ou para baixo. A ordem é salva por conta no armazenamento local e reaplicada quando o app for reaberto.
- O botão ✅ do cartão solicita a conclusão daquela tarefa. Após confirmação do backend, o item sai da lista e a quantidade é recalculada. Se não restarem itens, a galeria informa isso e oferece retorno a Pendências.
- A navegação de volta preserva busca e ordem local, sem iniciar outro fluxo de cadastro.

## Dados e ações

O backend expõe duas ações autenticadas pelo canal existente `/api/portal-chat`:

- `delegated_tasks_snapshot`: consulta `TAREFASDELEGADAS`, filtra no servidor registros com status diferente de `CONCLUÍDO` (incluindo status vazio), limita a uma quantidade segura e devolve os campos necessários para a galeria.
- `delegated_task_complete` com `taskId`: valida o ID, confirma que o registro ainda não está concluído e atualiza o campo `CONCLUÍDO` para `CONCLUÍDO`. Em seguida devolve uma nova fotografia da galeria.

O servidor continua sendo a fonte da verdade para status. A ordenação escolhida pelo usuário é uma preferência visual local, identificada pela conta e pelos IDs dos itens; itens novos entram ao final e itens removidos são descartados da preferência.

## Componentes

- `worker/workflow.py`: adiciona a opção e os estágios de Pendências, trata consulta, retorno e conclusão.
- `worker/clients.py`: fornece a consulta de registros e atualização segura no SharePoint, reutilizando o mapeamento de campos existente.
- `apps/energetico-mobile/src/chat/chat-client.js`: envia as duas ações e valida a resposta estruturada.
- `apps/energetico-mobile/src/app-controller.js`: carrega a galeria, mantém busca/ordenação e envia conclusão sem misturar com formulários ativos.
- `apps/energetico-mobile/src/ui/chat-view.js` e `src/styles.css`: renderiza a galeria acessível, busca, arraste e check.
- `apps/energetico-mobile/src/chat/conversation-store.js`: mantém no estado somente o snapshot atual; a preferência de ordem fica em armazenamento local por conta.

## Falhas e segurança

Consultas e conclusões usam autenticação já existente, não aceitam URLs ou campos arbitrários e tratam erro sem retirar o cartão localmente. Em falha de rede, o item permanece na galeria e pode ser tentado novamente. O botão de conclusão fica desabilitado durante a operação para impedir duplicidade.

## Verificação

Serão adicionados testes para: filtragem de status no backend, consulta e atualização por ID, opção condicional no menu, busca e ordenação persistente, arraste, conclusão, retorno e estados vazios/erro. Depois serão executados os testes completos e os builds web/PWA, Android e iOS acionados pelo `main`.
