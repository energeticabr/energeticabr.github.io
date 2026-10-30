# Editar o descritivo durante a baixa

A revisão terá EDITAR ALGUMA LINHA PROVISÃO e, abaixo, EDITAR O DESCRITIVO PROVISÃO. O segundo abre um seletor de colunas editáveis e depois somente o campo escolhido, com os metadados e catálogos reais já usados pela galeria de descritivos. Reutilizar o serviço existente de gravação e sincronização das provisões, inclusive FILIAL.

Antes de abrir, a VM registra um contexto de edição com token, descritivo e seleção. Enquanto ele existir, nenhuma baixa ou edição de linha pode avançar. O cliente também conserva o bloqueio durante envio, recuperação e gravação. Cancelar não grava; ao retornar sempre há releitura, pois uma confirmação perdida pode ter ocorrido após persistência.

Depois da gravação e da sincronização dos filhos, reler pai e todas as provisões na VM, reconstruir o snapshot e os valores usados na baixa. Alterações persistidas prevalecem nos campos modificados; rascunhos de linha não relacionados podem ser preservados. Seleção mantém somente IDs ainda elegíveis; novas linhas não são marcadas automaticamente. Anexos em preparação são preservados. Invalidar respostas dependentes e histórico que possa restaurar dados antigos. Falha de sincronização/releitura mantém o bloqueio e oferece retentativa sem repetir gravação confirmada.

Protocolo: `description_review_parent_begin:<parentId>:<selectedIds>`; tabela retorna `parentEditPending` e `parentEditorToken`; retorno por `description_review_parent_refresh:<parentId>:<token>`. Repetição é idempotente; token, pai ou sessão estranhos são recusados. Clientes antigos recebem uma orientação segura, sem escrever dados.

Não executar baixas nem edições financeiras reais em QA. Preservar os 14 blocos de assinatura. Revisar, testar e publicar backend, PC/web, Android interno e TestFlight conforme autorização permanente.
