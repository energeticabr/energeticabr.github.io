# Formas de pagamento por frequência

Na pergunta de forma de pagamento da baixa agendada, o workflow consulta as
últimas 100 provisões com `PGTOAGENDADO = PAGO`, em ordem decrescente de
`DATAPGTOEFETUADO`. Conta as ocorrências de `FORMAPGTO` por opção do catálogo.
Empates e falhas na consulta mantêm o ID crescente. A consulta é somente leitura.

O portal usa a ordem recebida quando a mensagem traz a apresentação
`payment_method_frequency`. Mensagens anteriores mantêm a ordem numérica.
Os IDs, a resposta enviada e o filtro por texto são preservados.

`source.patch` registra as duas mudanças na fonte privada do backend.
`patch_backend.py` aplica as alterações somente se os pontos de inserção
estiverem presentes uma vez. Use `PAYMENT_METHOD_WORKFLOW` apontando para uma
cópia do backend para executar `python -B test_regression.py -v`.
