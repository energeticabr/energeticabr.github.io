# Rótulo compacto das opções de baixa

Formato solicitado: `ID - FORNECEDOR (dd/mm/yyyy) - R$ VALOR TOTAL`.

Exemplo: `18 - SWILE (15/10/2026) - R$ 1,00`.

Retira DESCRITIVO e a lista de IDs filhos somente do texto visível. Preserva namespace, ID, valor, sourceKind e todos os dados vinculados. Não altera seleção, ordenação, cálculo, anexos ou baixa. Valor ainda desconhecido aparece como `VALOR PENDENTE`, nunca zero. Data inválida/ausente aparece como `—`.

Uma única função Python alterada no servidor compartilhado por Android, iOS e Windows; não requer reconstrução de clientes nativos.

Validação: 4 falhas esperadas de reprodução antes da alteração; **115 testes focados passaram e 1 contrato histórico substituído foi desmarcado** depois (cinco novos testes e 110 contratos de consulta/baixa/retomada). Revisão independente sem achados. A limitação da suíte ampla já registrada em ../provision-settlement-amount/verification.md continua sendo uma limitação de verificação, não se declara a suíte completa verde.

Empacotamento: `build_bundle.py PRIVATE_WORKSPACE`, com `baseline/worker` e `candidate/worker`; gera patch e manifesto públicos, bundle de fonte privado. Bytes fixados são preservados por .gitattributes. Reutiliza o instalador exato com verificação de hashes em produção/espelho, backup recuperável, compilação, rollback e saúde. Precheck: checked/health ok. Stage: `/home/opc/provision-option-label-20261017`.
