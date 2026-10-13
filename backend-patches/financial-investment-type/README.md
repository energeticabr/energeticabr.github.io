# Cadastro Tipo Investimento

Acrescenta o terceiro botão de FINANCEIRO → CADASTROS após investimento e instituição. Segue Screen16_1.pa.yaml#Form55: TIPO (RENDA FIXA/RENDA VARIÁVEL), DESCRICAO (texto opcional) e STATUS (ATIVO/INATIVO). TIPO e STATUS aceitam somente opções da lista fechada. O destino é CADASTROTIPOINVESTIMENTO; Title é a chave interna de idempotência. A gravação exige revisão e confirmação.

O instalador valida o hash e a configuração e comprova a preservação de todas as definições anteriores. deploy.sh executa seis testes do Form55 e dez testes dos dois cadastros anteriores antes de criar backup protegido e publicar, com rollback em caso de falha de saúde. Testes usam o motor real e adaptadores isolados, sem registros fictícios no SharePoint.

No checkout completo, as suítes anteriores ficam nas pastas irmãs financial-institution e financial-investment. Para usar apenas uma área temporária, copie também test_institution.py e test_investment.py para a mesma pasta desta implantação. A ausência de qualquer suíte interrompe a implantação antes de alterar configuração. test_investment_type.py importa apenas IsolatedEngine da suíte de instituição.

Menus e perguntas são publicados na VM para os clientes Android, iOS e Windows existentes, sem alteração de código cliente.
