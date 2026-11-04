# Comparação dos padrões dos fornecedores

O pacote aplica a exibição estruturada da comparação ao serviço de presenças. Antes de pedir confirmação, consulta os valores atuais em FORNECEDORES; se a consulta falhar, permite tentar novamente ou enviar somente as presenças. Antes de alterar o cadastro, confere novamente os dados comparados para exigir nova confirmação em caso de mudança concorrente. Clientes anteriores recebem o mesmo conteúdo em texto.

`package.py` gera candidatos a partir de cópias exatas dos dois arquivos instalados; `deploy.py` verifica os hashes, faz backup e valida o serviço, com rollback em caso de falha. Os testes locais de implantação usam `python -m unittest discover -s backend-patches/attendance-defaults-comparison -p test_deploy.py`. Os testes de integração `test_comparison.py` e `verify_deployed.py` usam os fixtures isolados do serviço no ambiente de validação.
