# Desconto global com acrescimo por valor negativo

O usuario quer informar -0,06 no desconto global para acrescentar seis centavos ao total de uma provisao ou lancamento. Manter valores positivos como desconto e preservar quantidade, frete, fornecedores, anexos e regras de confirmacao.

O servidor comum controla os dois fluxos. Usar um parser monetario assinado restrito ao ajuste global, finito e com ate duas casas decimais; nao permitir negativos nos demais campos. Nao alterar contratos de desconto positivo, limites de desconto acima do subtotal, nem aplicar ajuste novamente ao editar, resumir, retomar ou tentar persistir outra vez. Mostrar ACRESCIMO GLOBAL para valores negativos e orientar o usuario com exemplo -0,06. Totais da previa, linhas persistidas e pai/pedido devem coincidir em centavos. Preservar os mecanismos de precisao dos unitarios e a verificacao de transporte numerico.

Validar somente com dados sinteticos e destinos em memoria. Publicar a regra no servidor comum, com backup, hashes/CAS, gate/drain, saude e rollback. O backend comum entrega a Android, iOS e web/Windows, sem recompilar aplicativos sem mudanca de cliente. Codigo integral da VM e arquivos de configuracao ficam no workspace privado, nunca no repositorio publico. Blocos de assinatura permanecem intocados.

Ruling de compatibilidade apos revisao: preservar os formatos positivos que o lancamento ja aceitava (decimal internacional e agrupamento por espacos), inclusive fracao positiva de centavo legada. O parser possui opcao explicita somente nos chamadores de lancamento; provisoes e ajustes negativos continuam com no maximo duas casas decimais. Isso evita restringir um comportamento anterior sem pedido do usuario.
