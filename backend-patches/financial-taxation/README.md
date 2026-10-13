# Cadastro Tributação

Acrescenta o quinto botão de FINANCEIRO → CADASTROS, após rentabilidade. Segue Screen16_3.pa.yaml#Form53_1: TRIBUTACAO, STATUS e DESCRICAO nessa ordem, todos em texto conforme os controles originais. A lista de destino é TRIBUTAÇÃO; Title permanece interno para idempotência. Os campos opcionais podem ficar em branco. Gravação somente após revisão e confirmação.

O instalador valida o hash de origem, a configuração e a preservação exata das definições anteriores. deploy.sh roda os cinco testes deste cadastro e os 21 testes anteriores antes da implantação, com backup protegido e rollback em caso de falha de saúde. Nenhum registro fictício é criado no SharePoint; testes usam o motor real e adaptadores isolados.

No checkout completo, as suítes anteriores são encontradas nas pastas irmãs financial-institution, financial-investment, financial-investment-type e financial-profitability. Para implantar a partir de uma área temporária com apenas esta pasta, copie também test_institution.py, test_investment.py, test_investment_type.py e test_profitability.py para ela. A ausência de qualquer suíte interrompe a publicação antes de alterar configuração. A suíte nova importa somente IsolatedEngine da suíte de instituição.

Menus e perguntas são servidos pela VM aos clientes Android, iOS e Windows existentes, sem mudança no código cliente.
