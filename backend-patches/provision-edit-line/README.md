# Escolher a linha antes do campo da provisao

Na revisao de multiplas provisoes, **Editar** primeiro lista as linhas com numero, produto e fornecedor. Depois da escolha, a pergunta identifica a linha e oferece seus campos. Somente o snapshot escolhido e atualizado; o resumo do lote retorna para conferencia. Frete, desconto/acrescimo global, anexos, retomadas e a trava de gravacao iniciada sao preservados.

Wrapper de publicacao restrito a `worker/payment_provision_flow.py` e `worker/workflow.py` no servidor comum `/opt/energetica-whatsapp`. A mudanca de backend atende Android, iOS e web/Windows. Fontes completas e snapshots permanecem no workspace privado.

## Contratos sinteticos

Os testes da raiz usam somente arquivos temporarios e servicos simulados. Nao precisam do backend privado e nao gravam dados financeiros. O CI executa esses contratos em Linux com Python 3.9, a versao do host.

```sh
python -B -m unittest discover -s backend-patches/provision-edit-line -v
```

As protecoes incluem escopo exato de dois arquivos, hashes de manifesto e entradas, lock compartilhado, gate/drain, CAS antes da troca, backup privado, permissoes e propriedade, fsync, saude e rollback em `BaseException`. Instalacao e restauracao consomem bytes ja validados em memoria; a troca posterior do candidato ou do backup nao fornece bytes ao instalador. O gate existente e reutilizado sem alteracoes.

## Empacotamento apos congelamento

Executar somente depois de o main confirmar que o candidato de negocio esta congelado:

```sh
python -B backend-patches/provision-edit-line/package.py PRIVATE_WORKSPACE
```

`PRIVATE_WORKSPACE` contem `baseline/` e `candidate/`, fica fora do repositorio publico e recebe `source-files.tar` e `shared-deploy.py`. No repositorio, o comando gera somente `source.patch` minimo e `deploy-manifest.json`. Qualquer mudanca posterior de fonte ou wrapper exige novo empacotamento e revisao dos pins.

O release usa `/home/opc/provision-edit-line-20261031/release`. O mirror `/home/opc/energetica-build` e somente leitura, protegido pelos pins e nunca sincronizado. O runner compartilhado permanece fixado em `01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`; somente seus helpers de saude e reinicio sao usados pelo wrapper.

O rollout exige o SHA-256 revisado do manifesto como argumento de `deploy.sh`. Este diretorio prepara e testa o pacote; execucao de deploy, SSH e publicacao ficam a cargo do main.
