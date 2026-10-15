# Lançamento de vale-alimentação

No menu de lançamentos, oferecer a opção logo após a folha de pagamento. Abrir uma tela própria com todos os fornecedores ativos e empreiteiros, quantidade (padrão 1), valor unitário e total recalculado. Linhas com quantidade ou valor em branco ou zero não entram no lote.

Antes de postar, pedir data do lançamento, data prevista de pagamento, um único mês de referência, etapa, conta/forma de pagamento, pedido novo ou existente, OBS e anexos opcionais. O produto de cada linha é a profissão cadastrada do fornecedor; fornecedores sem profissão não podem ser enviados. Um lote exige filial única para que pedido e lançamentos permaneçam coerentes. Novo pedido usa FORNECEDOR=DIVERSOS para múltiplos fornecedores. Pedido existente precisa estar pendente, na mesma filial e ter fornecedor compatível; seu total deve ser atualizado com proteção de versão.

A confirmação mostra linhas, subtotal, total e IDFOLHA de cada fornecedor. Antes de qualquer gravação, cada fornecedor selecionado deve ter exatamente uma IDFOLHA do mês escolhido. A gravação cria/retoma um pedido, exatamente um lançamento e exatamente um vínculo FOLHAPGTO por fornecedor, usando tokens de operação, verificando a releitura no SharePoint e anexando arquivos ao pedido. O tipo de pagamento do vínculo usa a rubrica existente de vale-alimentação (`VALE REFEIÇÃO`). Falha parcial deve indicar o que já foi gravado e permitir retomar sem duplicar.

O lote em andamento conserva o identificador de operação no armazenamento local da conta para retomada após reiniciar o app. Anexos não têm seu conteúdo persistido: ao retomar, o usuário deve selecionar novamente os mesmos arquivos. Para pedido existente, o acréscimo no total é identificado por um marcador em OBS, aplicado junto com o valor em uma atualização condicional, para não somar duas vezes após falha ou edição concorrente. Anexo diferente com nome já presente no pedido é recusado explicitamente.

O fluxo não efetua a baixa financeira. O campo de data efetiva permanece vazio; pagamento será tratado em fluxo próprio.
