# Provisões pendentes: validar somente fornecedor sem folha

A confirmação de provisões pendentes no lançamento é dispensada quando existe
um ID positivo em `IDFOLHA` para o fornecedor do lançamento, de qualquer
competência. O fornecedor alternativo do pedido não determina essa exceção.
Sem folha, permanecem a pergunta, os IDs das provisões e a troca de fornecedor.
Respostas a avisos persistidos reconsultam a folha antes de interpretar os botões.
Falha na consulta propaga o erro sem confirmar nem gravar pagamento.

O patch modifica somente `worker/workflow.py` do servidor compartilhado,
atendendo Android, iOS e Windows/web sem atualização dos clientes.

## Verificação

`ORDER_SUPPLIER_SOURCE` aponta para uma cópia privada do runtime com as fixtures
sintéticas de `tests/test_workflow.py`. Nenhuma regressão grava dados reais.

```sh
ORDER_SUPPLIER_SOURCE=/private/candidate python -B test_exemption.py -v
python -B test_deploy.py -v
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

O pacote reutiliza o instalador testado de `order-supplier-registration` com
novos hashes, diretório e marcador de gate. Verifica baseline ativa, espelho
somente leitura, manifesto e entradas; usa lock compartilhado, gate/drenagem,
backup, troca atômica, reinício, saúde e rollback.

```sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/supplier-provision-payroll-exemption-20261119/release/deploy.py --check MANIFEST_SHA256
sudo -n bash /home/opc/supplier-provision-payroll-exemption-20261119/release/deploy.sh MANIFEST_SHA256
```
