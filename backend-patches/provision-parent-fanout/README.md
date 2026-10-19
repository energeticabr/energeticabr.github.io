# Anexos originais do descritivo nos registros vinculados

Corrige o caminho ausente DESCRITIVOPROVISAO → PROVISÃO PGTOS → LANCAMENTOS / NOTASPENDENTES.
O original é preservado. Nenhum registro financeiro, valor, data, status ou vínculo é criado/editado por esta sincronização.

## Regras

- Arquivos comuns do descritivo são copiados para a provisão de menor ID vinculada, um lançamento por pedido existente e os respectivos pedidos.
- Fornecedor, filial, vínculo provisão/descritivo, lançamento/provisão e lançamento/pedido são conferidos novamente antes de cada upload.
- Na baixa, os originais já existentes no descritivo chegam ao filho antes da leitura do ETag usado para marcá-lo como pago. A criação financeira continua exclusiva da baixa existente.
- Anexos incluídos depois da baixa também chegam aos destinos existentes.
- O hook executa após a confirmação do original. Quando o descritivo ainda não tem filhos, preserva o original e aguarda a reconciliação.
- O timer existente de dois minutos recupera inclusões diretas pelo SharePoint, destinos ausentes e operações interrompidas. Cache de metadados; reconferência horária do conteúdo.
- SHA-256 identifica conteúdo idêntico mesmo com nomes diferentes. Nomes determinísticos `DESC-ID-HASH-...` evitam sobrescritas e duplicação nas retomadas.
- Arquivos do namespace reservado `PROV-ID-HASH-...` com hash válido não são redistribuídos aos irmãos, inclusive se o original for removido ou o filho desvinculado. Cópias órfãs são preservadas e indicadas em `quarantined`. Os anexos por rubrica continuam vinculados à própria linha.
- A conferência completa do grupo ocorre nas fronteiras de cada arquivo; cada destino revalida apenas seu próprio vínculo. O teste de 30 pedidos limita o custo de consultas e impede crescimento quadrático.
- Processa um corpo de arquivo por vez. Não carrega o lote inteiro na memória.

Esta correção é do servidor compartilhado pelos aplicativos Windows/web, Android e iOS; não altera o cliente nem exige nova instalação nativa.

## Validação

`tests/test_fanout.py` executa o algoritmo real e o fluxo real de baixa agrupada, substituindo somente a fronteira do SharePoint. Cobre originais anteriores à baixa, inclusões posteriores, retomadas, conteúdo igual renomeado, colisões, corrupção, alteração de vínculos, propriedade, nenhum destino financeiro antecipado, múltiplos pedidos legados e recuperação pelo timer.

`tests/test_deploy.py` confere montagem privada, hashes, rejeição de drift e rollback dos dois diretórios, inclusive remoção somente do novo helper criado pelo instalador.

Validação do candidato: 36 testes aprovados no Windows e 1 teste de lock POSIX reservado ao runtime; no Python 3.9 do runtime, 26 testes funcionais (incluindo o lock concorrente), 23 regressões da baixa e 22 da sincronização anterior aprovados. Os 11 testes de instalação estão incluídos na execução Windows. O conector sintético incrementa versões nas gravações e rejeita ETags obsoletos; mover a cópia para depois da leitura do ETag fez a mutação falhar. Nenhum teste grava registros no tenant. A prévia real usa `dry_run=True`.

## Publicação reproduzível

O manifesto fixa os quatro arquivos alterados, os hashes anteriores de produção e espelho, o diff e o bundle privado. Os arquivos completos do backend e documentos reais ficam fora do repositório público.

1. Gerar `source.patch`, `deploy-manifest.json` e o arquivo privado `source-files.tar` usando `package.py`.
2. Preparar `/home/opc/provision-parent-fanout-20261019` com esses arquivos, `deploy.py` e o runner compartilhado fixado de `../launch-payroll-per-payment/deploy.py` (LF).
3. Aguardar a execução atual do timer e suspender novos disparos durante a instalação.
4. Executar `deploy.py --check SHA_DO_MANIFESTO`, depois `--deploy SHA_DO_MANIFESTO`. O instalador verifica drift, mantém backup, reinicia o bridge e confere `/health`; falhas restauram os dois diretórios.
5. Conferir o caso autorizado com `worker/provision_attachment_sync.py --parent ID --dry-run`; executar sem `--dry-run` sob o usuário do serviço e verificar os hashes dos quatro registros. Uma segunda execução não deve criar cópias.
6. Reativar o timer e conferir sua execução. Não é necessário alterar suas unidades.
