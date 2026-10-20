# Visita em obra: não oferecer outro diário na mesma filial/data

Mudança exclusivamente no motor compartilhado da VM. Android, iOS e web/Windows
recebem imediatamente a mesma regra, sem alteração ou nova instalação dos clientes.

Antes da pergunta `criar_diario_obra`, consulta `DIÁRIO DE OBRAS` por FILIAL e DATA
do dia corrente em `America/Sao_Paulo`, sem limitar STATUS. Se houver qualquer diário,
adota NÃO e avança diretamente ao resumo/confirmacão da visita, sem emitir a pergunta.
Sem diário, mantém as opções existentes SIM/NÃO.

O commit repete a consulta para sessões antigas e criação concorrente. O bloco de
criação é coordenado por filial/dia entre workers da mesma VM. O token do novo diário
também é estável por filial/dia, não por visita. Um checkpoint isolado no armazenamento
durável do motor precede o POST: um timeout ou crash com resultado desconhecido permite
somente consulta/reconciliação, nunca outro POST baseado apenas em uma lista vazia.
Um recibo com ID conhecido é conferido diretamente quando a consulta da lista está atrasada.

Diários existentes não são atualizados nem excluídos. A alteração não remove duplicidades
históricas e não pretende impor unicidade a outros aplicativos que gravem diretamente na lista.

## Verificação

- `tests/test_visit_diary.py`: motor real e cliente SharePoint real com respostas controladas;
  nenhum registro real é criado. Cobre status variados, filial/data, virada do dia, edição,
  resposta antiga, timeout aceito remotamente e ainda invisível, recibo, concorrência e confirmação.
- `tests/test_deploy.py`: escopo do bundle, hashes, drift, backup, cópia atômica e rollback.
- Resultados e limitações em `verification.md`.

Execute os testes com `ENERGETICA_BACKEND_TEST_ROOT` apontando para um snapshot privado
compatível do backend e `python -m pytest -q backend-patches/visit-existing-diary/tests`.

## Pacote e implantação

Somente `worker/workflow.py` e o novo `worker/construction_visit_diary.py` são instalados.
O diff e o manifesto são públicos; o bundle integral permanece fora do Git.

```text
python package.py --baseline <snapshot-antes> --candidate <snapshot-candidato> \
  --output <diretorio-deste-pacote> --mirror-hashes mirror-hashes.json \
  --archive-output <diretorio-privado>/source-files.tar
```

Prepare `/home/opc/visit-skip-existing-diary-20261020` com o manifesto, diff, bundle privado,
instalador e runner compartilhado `shared-deploy.py` cujo SHA-256 deve ser exatamente
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2` (bytes LF).
Use primeiro `sudo python3 deploy.py --check <sha256-do-manifesto>` e depois, na implantação
autorizada, `--deploy` com o mesmo hash. Os backups recuperáveis ficam em
`/var/backups/energetica-whatsapp/visit-existing-diary-<timestamp>`.
O instalador recusa mudanças concorrentes nos arquivos de produção e espelho.
