# Conferência de valores fracionários do SharePoint

O SharePoint devolve campos numéricos no JSON e pode representar valores
pequenos em notação científica. A confirmação falhava quando o mesmo valor
era enviado em formato decimal e lido como número com expoente.

A conversão de números já desserializados preserva seu valor com Decimal.
A leitura de textos localizados e a comparação de valores continuam usando
as mesmas regras. Os testes exercitam a confirmação real do cliente com
JSON sintético e cobrem valores iguais, divergentes, zero e texto inválido.

No diretório privado de implantação, coloque os arquivos deste pacote e
`test_dates.py` de `../provision-settlement-date-recovery/`. Execute
`deploy.py --check` e depois `deploy.py --apply` com o Python da VM. A
implantação verifica os hashes das duas origens e executa as regressões
antes de gravar. O instalador guarda os arquivos originais, reinicia os
serviços e restaura a versão anterior em caso de falha de saúde.

A correção é compartilhada pelo Android, iOS e Windows/web.
