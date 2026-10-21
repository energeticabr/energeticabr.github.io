# Verificação e bloqueio de ativação

## Implementação

- Cargo obrigatório para todo EMPREITEIRO=SIM, com oito opções, e admissão em campo de data.
- Índices de sessões anteriores migrados por chave; confirmação antiga não grava sem completar dados.
- Espelho histórico FUNCIONARIOSRH por IDFORNECEDORORIGEM único, todos os campos de negócio,
  auditoria original e anexos, sem inventar cargo/data de registros anteriores.
- Galeria de funcionários abaixo de Presenças, pesquisa completa paginada e regularização.
- Desligamento obrigatório ao inativar; atualização fonte/espelho com ETag e reconciliação explícita.
- Sincronizador protege contra leitura obsoleta e não desfaz inativação concorrente.
- Criação original e espelho têm checkpoints antes de POST: resposta incerta não autoriza duplicar.

## Testes executados

- 88 testes backend, esquema, permissões, criação, motor e instalador passaram em 20/10/2026.
- Suíte completa final do cliente após os ajustes de concorrência: 6.734 aprovados,
  dois skips, zero falhas (6.736 totais); os ajustes têm testes RED/GREEN específicos.
- Verificação final do cliente após os ajustes de concorrência: 526 testes direcionados
  aprovados, zero falhas, incluindo controlador, autenticação, galeria e inativação.
- Root/portal: 1.124 aprovados, seis skips, zero falhas. Builds web/PWA passaram.
- Prova visual com fixture sintética: galeria, dados pendentes de regularização e
  bloqueio de inativação sem desligamento. Nenhum funcionário real fictício foi criado.
- A execução indiscriminada de pytest na raiz encontrou 40 erros de coleta em pacotes
  históricos que exigem snapshots/variáveis próprios. Não é apresentada como suíte verde;
  os testes relevantes do backend usam o snapshot privado atual e têm comandos explícitos.

## Bloqueio real: autorização SharePoint

A consulta GET confirmou `FORNECEDORES.HasUniqueRoleAssignments=true`. A integração da
VM recebeu `403 Forbidden` em `/roleassignments`. Portanto não é possível certificar nem
reproduzir o mesmo acesso com a autorização atual. Os testes de 403 impedem qualquer POST
de esquema ou dados, tanto na criação imediata quanto no timer.

**Não ativado:** nova lista, colunas de admissão/desligamento, cópia de funcionários,
timer e novo fluxo/galeria em produção. Não concedemos privilégios, não ampliamos escopos
e não alteramos a lista original. Código permanece em revisão/draft até haver autoridade
administrativa apropriada para preservar os mesmos acessos, sem público adicional.

O provisionador clona os vínculos de principal/nível e ReadSecurity/WriteSecurity e exige
verificação antes dos dados. Casos com ACL individual desconhecida ou regras baseadas em
autor são recusados, não convertidos silenciosamente. Referência da API:
[permissões de listas com REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/set-custom-permissions-on-a-list-by-using-the-rest-interface).

A quebra de herança copia as atribuições existentes (`copyRoleAssignments=true`),
evitando a concessão automática de Full Control ao chamador. Falhas 403 no primeiro
grant e no meio dos grants foram reproduzidas em RED/GREEN; nenhuma cria esse acesso
extra, a lista fica vazia e a retomada reconcilia as permissões antes de copiar dados.

A correção independente do vencimento de provisões deve ser publicada separadamente;
não depende da nova base RH e não implica reagendar pagamentos reais para teste.
