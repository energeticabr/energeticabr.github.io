# Baixa automática de FGTS e INSS na folha individual

A baixa confirmada dos encargos individuais completa automaticamente a linha FOLHAPGTO da provisão. A folha deve ser única para o funcionário e a competência anterior ao vencimento previsto: fevereiro corresponde a janeiro; janeiro corresponde a dezembro do ano anterior. A competência original é preservada quando o pagamento ocorre em atraso.

O serviço confere o funcionário, a rubrica, a folha e o vínculo reverso do lançamento pago. Reutiliza a linha por IDPROVISAO, preserva os tokens APP e WA já existentes e registra a data efetiva e o IDLANCAMENTO. Se a linha estiver ausente, usa a chave estável APP-folha-provisao-ID com merge desativado e exige confirmação da gravação. A coluna IDPROVISAO deve permanecer exclusiva e indexada, conforme o contrato da automação mensal.

As atualizações usam ETag e leitura de confirmação. Falhas mantêm a recuperação da baixa já confirmada, sem repetir lançamentos financeiros. Conversas anteriores à publicação recebem uma conferência específica dos encargos, independente da marca antiga de consulta da folha. Provisões comuns continuam no fluxo opcional existente.

O módulo e os dois diffs alteram o serviço compartilhado e seu espelho de build. Android, iOS e Windows usam a mesma regra sem novos binários. Não há alteração de cálculo de encargos nem reparo retroativo de pagamentos nesta publicação.

## Testes

Defina WORKFLOW_SOURCE como o caminho do workflow candidato e execute:

```sh
python -m unittest discover -s backend-patches/provision-payroll-taxes/tests -v
python -m unittest discover -s backend-patches/provision-existing-payroll/tests -v
```

Os candidatos integrais permanecem privados. O manifesto fixa os hashes independentes de cada origem, candidato e diff. O instalador verifica os hashes, compila o código, usa o lock compartilhado, salva backups e reinicia os serviços com checagens de saúde e rollback. Execute primeiro `deploy.py --check STAGE MANIFEST_SHA256` e depois `--deploy` com o mesmo pacote validado.
