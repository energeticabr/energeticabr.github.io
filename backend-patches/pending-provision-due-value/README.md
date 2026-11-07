# Valor por vencimento em provisões pendentes

O cartão mantém o vencimento e o total do descritivo. Quando somente parte dos itens está pendente na data exibida, a consulta também informa `amountDueDisplay` (quantidade × valor unitário + frete, somados em decimal). Itens pagos e de outras datas não entram nesse subtotal. Quando todos os itens vencem juntos ou há apenas um item, o campo adicional é omitido. Se o subtotal não pode ser confirmado, o cartão exibe `— / total`; o tratamento de totais inválidos continua bloqueando a baixa como antes.

A edição do vencimento invalida o subtotal antigo e lê novamente o cartão depois de o SharePoint confirmar a sincronização das linhas. A impressão usa o mesmo texto do cartão.

`test_snapshot.py` verifica o contrato com registros fictícios no ambiente do worker. Para montar a entrega, copie as duas fontes originais para um estágio privado como `production.py` e `mirror.py`, execute `package.py` e valide ambos os candidatos com `verify_candidate.py`. Publique pelo instalador protegido, com manifesto, lock, gate, backup, verificação de saúde e rollback. Só o módulo do snapshot é alterado; os dados do SharePoint são consultados sem gravação.
