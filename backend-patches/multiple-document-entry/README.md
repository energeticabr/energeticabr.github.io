# Documentos em sequência

ADICIONAR UM NOVO DOCUMENTO oferece documento único (caminho existente) ou diversos.
No modo diversos, ADICIONAR MAIS UM DOCUMENTO grava a linha e seus anexos antes de
oferecer edição dos dados comuns do próximo. PROSSEGUIR SEM EDITAR pergunta apenas
TIPODOCUMENTO e coleta outro anexo. SUBMETER SEM ADICIONAR MAIS DOCUMENTOS grava
o último e conclui. A alteração é executada pelo servidor compartilhado, portanto
fica disponível nos clientes Android, iOS e Windows/web sem reinstalação.

Checkpoints duráveis, separados por conversa/lote/linha, impedem que retry, rascunho
ou navegação regravem um item. Campos, anexos e intenção de continuar/encerrar ficam
congelados antes da primeira escrita. Uma criação com resultado desconhecido permite
somente reconciliação pelo token; uma consulta vazia não autoriza outro POST. Enquanto
isso, o usuário deve concluir a tentativa preservada. Cancelar um documento posterior
não exclui os anteriores. Não modifica documentos nem anexos históricos.

## Testes locais

Defina `ENERGETICA_BACKEND_TEST_ROOT` para um snapshot privado compatível do servidor
e execute `python -m pytest -q backend-patches/multiple-document-entry/tests`.
Todos os catálogos, mídia e registros são sintéticos; não há chamadas ao SharePoint.
`patch_backend.py <baseline> <candidate-novo>` compila as fontes e recusa âncoras
ausentes/ambíguas ou candidato existente.

O QA visual usa `qa_server.py` apenas em `127.0.0.1:8877` e a fixture
`tests/fixtures/multiple-documents-browser.html` servida pelo Vite com proxy local
`/document-qa`. Não publica registros reais. Não executar esse servidor de QA em
produção nem expô-lo na rede.

## Implantação

O diff e manifesto públicos fixam somente:

- `worker/workflow.py`: integração com o formulário existente;
- `worker/document_batch.py`: novo fluxo sequencial;
- `diary_progress.py`: dependência já existente e **inalterada** na produção,
  ausente no espelho anterior. Incluí-la evita quebrar o import do motor no espelho.

O bundle integral permanece privado. Preparar `/home/opc/multiple-document-entry-20261021`
com `deploy.py`, `source.patch`, `deploy-manifest.json`, `source-files.tar` privado e
`shared-deploy.py` proveniente de `backend-patches/launch-payroll-per-payment/deploy.py`.
O SHA-256 do runner, com bytes LF, deve ser
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`.

Executar primeiro `sudo python3 deploy.py --check <sha256-do-manifesto>`.
Na implantação autorizada, usar o gate/drain já testado em
`backend-patches/diary-attachment-progress/deployment_gate.sh`: bloquear novas conexões
locais à ponte, aguardar requisições em andamento e manter o gate até terminar
`sudo python3 deploy.py --deploy <mesmo-sha256>`, com trap de liberação e watchdog.
Não interromper requisições em andamento para forçar a implantação.

O instalador confere hashes independentes de produção/espelho, raiz sem aliases,
escopo do tar, lock, compilação, cópias atômicas, saúde e rollback. Backups recuperáveis
ficam em `/var/backups/energetica-whatsapp/multiple-document-entry-<timestamp>`.
Conferir recibo e hashes nas duas raízes depois do reinício. Nenhum dado de negócio,
estado de conversa, documento ou credencial integra o repositório público.
