# Salário pago e esperado no relatório de folhas

No cluster verde SALÁRIO de cada fornecedor, mostrar `R$ pago / R$ esperado` para o mês filtrado. Reutilizar o total pago existente. O esperado é o salário mensal integral cadastrado, sem adicionais, encargos ou rateio por dias.

Ler FUNCIONARIOSRH e CARGOS de forma paginada no mesmo snapshot do relatório. Relacionar FORNECEDORES.id a FUNCIONARIOSRH.IDFORNECEDORORIGEM; usar CARGO para buscar SALARIO e DATAREFERENCIA em CARGOS. Escolher a última vigência até o fim do mês. Não vincular por aproximação de nome, profissão ou ordem de linhas. Identidade ausente/ambígua, valor inválido ou fonte incompleta resulta em esperado não informado, sem inventar zero nem esconder o pago.

Cada competência distinta conta uma vez, mesmo com múltiplos IDFOLHA. Em Todos, somar somente as competências exibidas e conhecidas, sem repetir o salário por folha. O novo dado acompanha o filtro, refresh e o snapshot da sessão, respeitando cancelamento. Outras rubricas e totais permanecem com seu significado atual. Validar o texto visível, IDs, falhas, paginação e layout em telefone/desktop com dados fictícios. Publicar web/Windows, Android interno e TestFlight, preservando os blocos de assinatura.
