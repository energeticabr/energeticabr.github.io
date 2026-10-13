# Cadastro de Rentabilidade

Adiciona o quarto botão em FINANCEIRO → CADASTROS, após investimento, instituição e tipo de investimento. Segue Screen16_2.pa.yaml#Form53: RENTABILIDADE (texto opcional) e STATUS (ATIVO/INATIVO em seleção fechada). Grava na lista RENTABILIDADE após revisão e confirmação; Title fica como chave interna de idempotência.

O instalador confere o hash de origem, valida a configuração e comprova que apenas a ação e o fluxo novos foram adicionados. deploy.sh executa cinco testes deste formulário e os 16 testes anteriores, cria backup protegido e publica com rollback em caso de falha de saúde. Não há registros fictícios criados na base: os testes usam o motor instalado com adaptadores externos isolados.

Para implantar pelo checkout completo, as suítes anteriores são encontradas nas pastas irmãs financial-institution, financial-investment e financial-investment-type. Ao copiar somente esta pasta para uma área temporária, copie também test_institution.py, test_investment.py e test_investment_type.py para ela. A ausência de uma suíte interrompe a publicação antes de qualquer alteração de configuração. test_profitability.py importa somente IsolatedEngine da suíte de instituição.

Menus e perguntas são publicados na VM para os clientes Android, iOS e Windows já existentes, sem mudança no código cliente.
