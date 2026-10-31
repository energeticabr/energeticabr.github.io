# Desconto global assinado: desconto e acrescimo

Na provisao de pagamento e nos lancamentos, o valor positivo continua sendo desconto. O valor negativo representa acrescimo: `-0,06` aumenta `R$ 61.599,94` para `R$ 61.600,00`. As perguntas explicam o sinal; a previa e as observacoes usam **ACRESCIMO GLOBAL** quando aplicavel.

O parser assinado e restrito ao ajuste global, com valores finitos e ate duas casas decimais nas provisoes e nos acrescimos. Os lancamentos preservam os formatos e fracoes positivos legados. Quantidades, precos e fretes permanecem nao negativos. O rateio preserva as quantidades e o frete, restaura os unitarios originais ao editar e valida centavos na fronteira numerica, inclusive o transporte do total do pai. Retomadas e novas tentativas preservam a idempotencia e os journals financeiros existentes.

## Validacao

Os testes em `tests/` carregam o motor real de um snapshot privado apontado por `ENERGETICA_BACKEND_TEST_ROOT` e usam destinos sinteticos em memoria. Os contratos de empacotamento/instalacao da raiz executam sem snapshot e sao verificados em CI.

```sh
python -B -m unittest discover -s backend-patches/signed-global-discount/tests -v
python -B -m unittest discover -s backend-patches/provision-global-discount/tests -v
python -B -m unittest discover -s backend-patches/signed-global-discount -v
```

## Publicacao

O pacote altera somente `worker/payment_provision_group.py`, `worker/payment_provision_flow.py`, `worker/workflow.py` e `worker/workflow_config.json` no servidor comum. O mirror de build permanece somente leitura, protegido pelos hashes. O pacote integral e o arquivo `source-files.tar` ficam fora deste repositorio publico; `source.patch` registra apenas o diff revisavel.

O instalador exige hashes de manifesto/entradas, baseline exato, gate/drain, lock compartilhado, backup, verificacao de saude e rollback. A mudanca de servidor vale para Android, iOS e web/Windows sem nova instalacao dos clientes.
