# Validação da data de depreciação

A lista `LANCAMENTOS` tem uma validação para registros com `DEPRECIACAOCHAVE`:
as datas de pagamento previsto e efetuado devem ser do dia 01 da competência
indicada pelo prefixo `aaaa-mm`, e `CONTA` deve ser DEPRECIAÇÃO E AMORTIZAÇÃO.
O fluxo mensal grava essas datas à meia-noite de São Paulo (`03:00Z`) e inclui
a chave `aaaa-mm|id-do-ativo`. A chave é única e indexada, e não aparece nos
formulários padrão de inclusão ou edição. A coluna permanece acessível ao conector:
configurá-la como `Hidden` impediria a gravação do fluxo.

```text
=IF(ISBLANK([DEPRECIACAOCHAVE]),TRUE,AND(DAY([DATA PGTO PREVISTO])=1,DAY([DATA PGTO EFETUADO])=1,TEXT([DATA PGTO PREVISTO],"yyyy-mm")=LEFT([DEPRECIACAOCHAVE],7),TEXT([DATA PGTO EFETUADO],"yyyy-mm")=LEFT([DEPRECIACAOCHAVE],7),[CONTA]="DEPRECIAÇÃO E AMORTIZAÇÃO"))
```

A validação não impede alterações de registros antigos sem a chave: não se deve
inferir um ID patrimonial a partir de nomes repetidos. A chave técnica é parte
da integridade da trava e não deve ser alterada por integrações ou administradores.
O SharePoint não compara valores anteriores em validação de lista: uma integração
com acesso direto capaz de remover ou substituir a chave pode contornar a regra.

A regra foi exercitada em lista temporária com a mesma configuração regional e
conector do fluxo: criação de registro válido; rejeição de dia anterior e conta
vazia; rejeição de meia-noite UTC que representa o dia anterior no fuso local;
aceitação de edição de outro campo, anexo e registro comum sem chave. Após tirar
a chave dos formulários padrão, a criação via conector continuou funcionando.
Os registros fictícios foram reciclados junto com a lista temporária.

Na galeria, registros legados de depreciação com datas de pagamento armazenadas
exatamente à meia-noite UTC são mostrados pelo dia civil registrado. Outros
instantes e datas de auditoria continuam convertidos para São Paulo. O editor
envia apenas campos efetivamente modificados e mostra antes/depois para revisão.
