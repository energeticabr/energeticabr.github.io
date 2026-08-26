# Autoridade de acesso no SharePoint

## Estado de producao

O portal permanece fechado para todos os usuarios comuns ate que o superadministrador
`bernardonotini@energeticabr.com` execute a pre-visualizacao, aplique o plano com a
confirmacao explicita e receba uma verificacao integralmente aprovada. A implementacao
desta frente nao executa configuracoes no ambiente Microsoft.

## Fonte de autoridade

As permissoes exibidas em `PORTAL_ACESSOS` orientam a interface, mas nao autorizam uma
operacao sozinhas. Cada leitura ou escrita exige simultaneamente:

1. cadastro ativo, identidade Microsoft unica e permissao `MODULO_*` correspondente;
2. lista presente no catalogo permitido do portal;
3. ACL exclusiva na lista SharePoint, sem heranca ampla;
4. permissao efetiva SharePoint exatamente igual ao contrato completo do cadastro.

O portal bloqueia a acao quando a ACL e herdada ou desconhecida, quando o SharePoint
concede qualquer direito adicional, inclusive direitos administrativos fora das cinco
acoes da interface, quando falta a permissao solicitada ou quando ha duplicidade de
identidade. A consulta efetiva usa cache curto de 15 segundos e e invalidada depois de
alteracoes de acesso.

## Grupos e funcoes

O plano cria grupos separados por modulo e acao, no formato
`ENERGETICA_PORTAL_<MODULO>_<ACAO>`. As acoes suportadas sao `VIEW`, `CREATE`, `EDIT`,
`DELETE` e `APPROVE`. Funcoes SharePoint dedicadas carregam uma mascara
`BasePermissions` exata: os direitos basicos de acesso remoto e somente o direito
operacional da acao. Nome de funcao nao e prova de autoridade. A verificacao compara
os 64 bits da mascara e rejeita qualquer bit inesperado, inclusive o bit 64 reservado.
Como `approveItem` altera campos por `PATCH`, a funcao `APPROVE` inclui simultaneamente
`EditListItems` e `ApproveItems`.

Cada lista recebe atribuicoes exatas aos grupos do seu modulo. A conta do
superadministrador e preservada com `Full Control` em todas as listas para recuperacao.
Essa funcao nativa e identificada por `RoleTypeKind = 5`, sem depender do idioma do
nome exibido pelo SharePoint.
Grupos, funcoes e usuarios sao provisionados separadamente em cada site SharePoint.

## Pre-visualizacao e aplicacao

Na pagina **Usuarios e acessos**, somente o superadministrador pode:

1. selecionar **Pre-visualizar configuracao** para calcular listas, grupos e impacto sem
   alterar o SharePoint;
2. conferir a prova SHA-256 da pre-visualizacao, calculada sobre o plano e o retrato
   atual completo das ACLs;
3. informar `APLICAR SEGURANCA SHAREPOINT` e selecionar **Aplicar configuracao de
   seguranca**;
4. aguardar a verificacao das ACLs resultantes.

Uma pre-visualizacao obsoleta, uma atribuicao adicional, uma lista com heranca ou uma
falha parcial impedem o manifesto de seguranca. O manifesto anterior e inativado antes
da primeira mutacao. Para abrir o portal comum, o recibo precisa ter `createdBy` e
`lastModifiedBy` emitidos pelo SharePoint para o superadministrador, e a conta precisa
comprovar ao vivo sua mascara efetiva exata em cada fonte concedida. Texto, campos ou
hash isolados nao concedem acesso. O usuario comum nao enumera `RoleAssignments`; a
leitura administrativa integral permanece exclusiva do setup e da verificacao do
superadministrador.

Cada lista e cada `RoleDefinition` tocada conserva seu snapshot recuperavel. Se a
aplicacao ou a verificacao falhar, ACLs e funcoes sao restauradas em ordem inversa;
funcoes criadas durante a tentativa sao removidas depois de desfazer as atribuicoes.
Um rollback incompleto produz estado de falha parcial e mantem o portal fechado.

## Atualizacao do esquema de acessos

`ensureList` nao trata uma lista existente como pronta apenas por possuir `EMAIL` e
`MICROSOFT_OID`. Em toda execucao ele le o esquema atual de `PORTAL_ACESSOS`, compara
todos os modulos do catalogo e cria cada coluna `MODULO_<MODULO>_<ACAO>` ausente.

Assim, quando um modulo como `relatorios` entra no catalogo, uma lista antiga recebe
`MODULO_RELATORIOS_VIEW`, `CREATE`, `EDIT`, `DELETE` e `APPROVE`. Reexecutar o setup nao
duplica colunas. As propriedades indexada e unica de `EMAIL` e `MICROSOFT_OID` tambem
sao corrigidas quando necessario.

## Alteracao e revogacao

Salvar um acesso ativo grava primeiro o cadastro como `INATIVO`, sincroniza e rele todos
os grupos, compara a mascara efetiva completa e somente entao ativa o registro usando o
ETag mais recente. Falha ou concorrencia executa compensacao, remove os grupos e mantem
a conta negada.

Revogar primeiro inativa o cadastro e depois remove os grupos em todos os sites
catalogados, mesmo quando uma lista de entidade esta ausente. Falhas sao agregadas e
nunca transformadas em sucesso parcial. Grupos ausentes durante revogacao equivalem a
participacao ja removida; os demais continuam sendo processados. Na concessao, grupo
ausente e falha fechada, mas nao impede a compensacao ou a verificacao dos outros
grupos.

## Escopos delegados

Consultas comuns ao Graph usam `Sites.Read.All`. Escritas de itens pedem
`Sites.ReadWrite.All` somente na operacao de escrita. No REST SharePoint, leitura,
escrita/anexos e gestao de ACL usam respectivamente `AllSites.Read`, `AllSites.Write` e
`AllSites.Manage`. O escopo de gestao fica restrito ao setup explicito e as alteracoes
ou revogacoes de grupos que tecnicamente dependem dele.

## Contratos Microsoft

- [Permissoes personalizadas em listas pelo SharePoint REST](https://learn.microsoft.com/pt-br/sharepoint/dev/sp-add-ins/set-custom-permissions-on-a-list-by-using-the-rest-interface)
- [Criar uma coluna de lista pelo Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/list-post-columns?view=graph-rest-1.0)
- [Listar colunas de uma lista pelo Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/list-list-columns?view=graph-rest-1.0)
- [Atualizar definicoes de coluna pelo Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/columndefinition-update?view=graph-rest-1.0)
- [PermissionKind do SharePoint](https://learn.microsoft.com/en-us/dotnet/api/microsoft.sharepoint.client.permissionkind?view=sharepoint-csom)
- [Escopos de permissao do Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-reference)
