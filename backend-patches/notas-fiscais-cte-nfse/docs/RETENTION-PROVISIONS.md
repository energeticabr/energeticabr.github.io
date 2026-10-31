# Provisões automáticas de retenções fiscais

O receptor fiscal cria uma `PROVISÃO PGTOS` para cada NF-e ou NFS-e de entrada, autorizada e completa que declare retenção positiva do comprador. O vencimento é o dia 20 do mês seguinte à emissão. As provisões do mesmo vencimento compartilham uma única linha em `DESCRITIVOPROVISAO`.

O filho grava `QTD=1`, `VALORTOTAL` igual à retenção, `OBS` com a razão social, `DATAPREVISTOPGTO`, `STATUS=PAGAMENTO PREVISTO` e `FILIAL=004 - EDIFÍCIO XAVANTE`. A rubrica mensal recebe o mesmo status e a mesma filial. Os demais campos de negócio ficam vazios. Pai e filho usam o campo técnico único `FOLHAOPERACAO`, com prefixo `RETENCAO-`, para que uma repetição do mesmo XML não duplique registros. Após garantir o filho, o fluxo relê todos os filhos técnicos do mês e recompõe o total do pai.

NF-e soma os seis componentes de retenção do XML. NFS-e soma contribuições sociais agregadas, IRRF, INSS e ISS retidos pelo tomador; `TOTAL_RETIDO` não é somado novamente. CT-e, saídas, terceiros, eventos, resumos, canceladas, substituídas e valores zerados não criam provisão.

## Publicação

1. Gere `02` e `03` com `build-flows.mjs` e `build-live-flows.mjs` usando a configuração local já instalada.
2. Execute `Deploy-RetentionProvisions.ps1 -Mode Check` para conferir o estado ao vivo sem alterar o fluxo.
3. Execute `Deploy-RetentionProvisions.ps1 -Mode Deploy`. O script salva a definição anterior, publica somente o receptor `03`, relê a ação completa e executa um lote vazio.
4. Execute `Deploy-RetentionProvisions.ps1 -Mode Verify` para uma nova conferência independente.

Se publicação, releitura ou lote vazio falhar, o modo `Deploy` restaura automaticamente a definição que estava ativa. O lote vazio não grava nota nem provisão financeira.

