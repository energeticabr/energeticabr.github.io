# Anexos do lançamento na folha de pagamento

Ao criar um item em `FOLHAPGTO`, o fluxo copia os anexos do `LANCAMENTOS` indicado por `IDLANCAMENTO` antes de confirmar o pagamento. Usa o mesmo vínculo nas atribuições individuais, coletivas e na baixa com lançamento gerado. Provisão sem lançamento não usa o ID da provisão como ID de lançamento.

Cada nome de origem corresponde a um arquivo de destino. Dois nomes diferentes com bytes iguais continuam sendo dois anexos. A cópia mantém os nomes e bytes; se um nome já pertence a outro conteúdo no destino, conserva esse arquivo e usa um nome determinístico com o ID do lançamento e hashes do nome/conteúdo. Não remove nem substitui anexos.

Inventários paginados, fornecedor/filial da origem e vínculo do destino são verificados. A confirmação exige leitura dos bytes e SHA-256 de origem e destino. Mudança de origem ou falha de cópia impede o checkpoint de sucesso; a tentativa seguinte reutiliza o token financeiro existente e os arquivos já confirmados.

## Validação

Os testes de integração precisam de uma cópia privada atual do backend, suas dependências e fixtures `tests/test_workflow.py`. Não usam registros financeiros reais.

```sh
PER_PAYMENT_SOURCE=/path/to/backend python -B backend-patches/launch-payroll-attachments/tests/run_features.py --existing
python -B -m unittest discover -s backend-patches/launch-payroll-attachments/tests -p test_deploy.py -v
```

O instalador é validado em Linux. A comparação da suíte legada completa é registrada separadamente; uma suíte legada vermelha não é apresentada como aprovada.

## Publicação

O pacote transforma somente `worker/workflow.py` e `worker/payroll_row_attachments.py`, preservando as diferenças entre produção e mirror e os finais de linha próprios de cada raiz. O manifesto fixa os hashes de entrada e saída e os scripts do pacote. O instalador rejeita divergência, usa lock compartilhado, backup, troca atômica, pausa de novas requisições com watchdog, verificação de saúde e rollback.

O pacote aprovado deve ser copiado para `/var/lib/energetica-deploy/launch-payroll-attachments-20261104`, pertencente a root e sem permissão de escrita de grupo/outros. Executar `deploy.sh <sha256-do-manifesto>` após os testes/revisão/CI; o script valida o manifesto antes de pausar a entrada e instalar.

Android, iOS e Windows/web usam o mesmo servidor. Esta alteração não modifica o app nem exige novos binários. A publicação não altera configurações, históricos, conversas ou registros financeiros. A regra passa a valer para novas submissões; não há migração de folhas antigas.
