# Valor pago no cartão de provisões pendentes

O snapshot informa `amountPaidDisplay` quando há um subtotal confirmado para o vencimento exibido, pelo menos duas datas de vencimento no descritivo e parcelas confirmadas como pagas. A soma usa a mesma regra de quantidade, valor e frete do subtotal por vencimento.

Para montar o estágio privado, reutilize `package.py`, `deploy.py` e `deployment_gate.sh` de `../pending-provision-due-value`, com o `patch_backend.py` e o `deploy.sh` deste diretório. Gere os candidatos a partir de `production.py` e `mirror.py` e compare o manifesto com o desta entrega. Execute os testes dos dois snapshots em cada candidato antes de usar o instalador protegido.
