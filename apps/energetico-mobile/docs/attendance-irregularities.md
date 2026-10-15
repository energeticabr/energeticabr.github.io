# Justificativa de jornadas irregulares na validação de presenças

Na lista pessoal `DESCRITIVOPRESENCA`, a coluna `IRREGULARIDADES` deve ter nome interno `IRREGULARIDADES`, tipo SharePoint `Note` (texto multilinha simples), sem acréscimo automático de alterações. A coluna foi criada no ambiente de produção em 14/10/2026 e confirmada com `ReadOnlyField=false`, `RichText=false` e `AppendOnly=false`.

O total trabalhado vem das batidas efetivas exibidas no RHID para o mesmo fornecedor e dia. Segunda a quinta: pedir justificativa abaixo de 8h45 ou acima de 9h30; sexta: abaixo de 7h40 ou acima de 8h20. Os limites são inclusivos. Sábado e domingo não têm limite definido nesta regra. Quando o RHID ainda está carregando, a escolha aguarda o término da consulta. Sem total confiável, esta regra não inventa horas.

Ao submeter a justificativa, o app confere ID, data, esquema da coluna e versão do registro, e atualiza somente `IRREGULARIDADES`. O checkbox é marcado apenas após a confirmação da gravação. A escolha da presença continua separada e só começa no clique posterior em `PROSSEGUIR`; o botão individual segue após a gravação. Cancelar ou falhar mantém a presença sem seleção/avanço.
