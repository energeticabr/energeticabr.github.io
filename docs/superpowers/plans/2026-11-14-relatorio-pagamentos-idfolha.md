# Pagamentos pendentes de IDFOLHA

O relatório usa a data efetiva do pagamento e o total de LANCAMENTOS (quantidade × unitário + frete). Exclui receitas, valores sem saldo e lançamentos já vinculados no lançamento, em FOLHAPGTO ou pela provisão. Percorre a fonte completa e pagina a exibição. Cada aplicação grava em FOLHAPGTO o ID de origem e o valor aplicado. Um identificador distingue o rateio dos vínculos históricos.

1. Testar e implementar a listagem, fornecedores e IDFOLHA, detalhe e aplicação total ou parcial. Validar valor, confirmação, competência e revisão no servidor. Reservar o lançamento antes de gravar e conferir a aplicação no SharePoint antes de atualizar o saldo.
2. Integrar as rotas ao servidor autenticado. Usar a mesma trava por origem no relatório, na criação pela galeria e no fluxo do WhatsApp. Preservar o histórico e recusar alterações de identidade ou de valor que invalidem aplicações.
3. Posicionar o atalho abaixo do RHID. Integrar a busca de fornecedor, seleção de competência e rubrica, confirmação e retomada por lançamento. Verificar a tela em larguras móveis e Windows.
4. Usar o valor da aplicação, com seu ID de origem, nos relatórios e no desdobramento da folha. O valor integral da origem continua sendo usado nos vínculos anteriores.
5. Conferir testes, builds PWA e nativo e a trava de assinatura. Implantar e verificar o servidor sem ratear pagamentos reais. Distribuir a mesma revisão em Pages, Google Play interno e TestFlight.
