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
4. permissao efetiva SharePoint exatamente compativel com o cadastro do portal.

O portal bloqueia a acao quando a ACL e herdada ou desconhecida, quando o SharePoint
concede mais direitos do que o cadastro, quando falta a permissao solicitada ou quando
ha duplicidade de identidade. A consulta efetiva usa cache curto de 15 segundos e e
invalidada depois de alteracoes de acesso.

## Grupos e funcoes

O plano cria grupos separados por modulo e acao, no formato
`ENERGETICA_PORTAL_<MODULO>_<ACAO>`. As acoes suportadas sao `VIEW`, `CREATE`, `EDIT`,
`DELETE` e `APPROVE`. Funcoes SharePoint dedicadas carregam apenas os direitos basicos
de acesso remoto e o direito operacional da acao.

Cada lista recebe atribuicoes exatas aos grupos do seu modulo. A conta do
superadministrador e preservada com `Full Control` em todas as listas para recuperacao.
Grupos, funcoes e usuarios sao provisionados separadamente em cada site SharePoint.

## Pre-visualizacao e aplicacao

Na pagina **Usuarios e acessos**, somente o superadministrador pode:

1. selecionar **Pre-visualizar configuracao** para calcular listas, grupos e impacto sem
   alterar o SharePoint;
2. conferir o identificador imutavel da pre-visualizacao;
3. informar `APLICAR SEGURANCA SHAREPOINT` e selecionar **Aplicar configuracao de
   seguranca**;
4. aguardar a verificacao das ACLs resultantes.

Uma pre-visualizacao obsoleta, uma atribuicao adicional, uma lista com heranca ou uma
falha parcial impedem o manifesto de seguranca. Sem manifesto verificado, o portal
continua fechado para contas comuns.

## Atualizacao do esquema de acessos

`ensureList` nao trata uma lista existente como pronta apenas por possuir `EMAIL` e
`MICROSOFT_OID`. Em toda execucao ele le o esquema atual de `PORTAL_ACESSOS`, compara
todos os modulos do catalogo e cria cada coluna `MODULO_<MODULO>_<ACAO>` ausente.

Assim, quando um modulo como `relatorios` entra no catalogo, uma lista antiga recebe
`MODULO_RELATORIOS_VIEW`, `CREATE`, `EDIT`, `DELETE` e `APPROVE`. Reexecutar o setup nao
duplica colunas. As propriedades indexada e unica de `EMAIL` e `MICROSOFT_OID` tambem
sao corrigidas quando necessario.

## Alteracao e revogacao

Salvar um acesso ativo sincroniza a participacao nos grupos de todos os sites envolvidos
e depois compara as permissoes efetivas de cada lista. Revogar primeiro inativa o
cadastro e depois remove os grupos. Qualquer falha de reconciliacao mantem a conta
negada e apresenta a acao corretiva ao superadministrador.

## Contratos Microsoft

- [Permissoes personalizadas em listas pelo SharePoint REST](https://learn.microsoft.com/pt-br/sharepoint/dev/sp-add-ins/set-custom-permissions-on-a-list-by-using-the-rest-interface)
- [Criar uma coluna de lista pelo Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/list-post-columns?view=graph-rest-1.0)
- [Listar colunas de uma lista pelo Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/list-list-columns?view=graph-rest-1.0)
- [Atualizar definicoes de coluna pelo Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/columndefinition-update?view=graph-rest-1.0)

