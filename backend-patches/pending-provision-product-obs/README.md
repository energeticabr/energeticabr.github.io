# Observação no produto das provisões pendentes

O snapshot mantém `product` e acrescenta `productDisplay` quando há OBS nas provisões vinculadas. O texto usa o `PRODUTO` e a `OBS` da mesma linha de `PROVISÃO PGTOS`. O campo OBS do descritivo fica fora desse resumo.

Para montar o estágio privado, use `package.py`, `deploy.py` e `deployment_gate.sh` de `../pending-provision-due-value` com o `patch_backend.py` e o `deploy.sh` deste diretório. Gere os candidatos com as fontes independentes `production.py` e `mirror.py` e compare o manifesto com o registrado nesta entrega. Execute os testes de snapshot de observação, vencimento e valor pago em cada candidato. Use o instalador protegido para publicar, com drenagem das requisições, backup e verificação de saúde.
