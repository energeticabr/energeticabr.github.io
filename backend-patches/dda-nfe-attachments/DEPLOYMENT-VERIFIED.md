Implantação verificada em 17/11/2026, com conferência independente final às 17:26 UTC.

- Worker OCI e bridge fiscal publicados. Bridge `63618d6b-74aa-4a3d-a315-60cdd788d201` relido em `Started`, com modos `inventory`, `pdf` e `dda_sync`; últimas 100 execuções consultadas sem falhas.
- 23 PDFs originais DDA copiados para 18 registros fiscais correspondentes a 22 DDAs. Duas notas têm três parcelas cada; um DDA tem dois espelhos. Nenhuma correlação foi flexibilizada.
- Catálogo atual de originais conferido integralmente. Todos os 23 PDFs foram baixados independentemente dos dois sites e tiveram SHA-256 idêntico à origem e ao recibo.
- 189 anexos fiscais anteriores preservados; 72 anexos DDA anteriores preservados por hash. Valores, datas e identificadores das duas listas permaneceram iguais, assim como o significado dos status.
- Foram observadas variações concorrentes de caixa em SITUACAO (`Em aberto` / `Em Aberto`) nos IDs DDA 43, 44, 49, 50, 51, 52, 53, 54 e 55, sem mudança semântica. Na amostra 43/44/55 o editor SharePoint foi Bernardo notini; o processo responsável não foi identificado. O reconciliador não alterou nem restaurou esses campos.
- Replay do mesmo serviço utilizado pelo timer: `ExecMainStatus=0`, zero erros e zero anexos novos nas duas direções. Oito pares reversos foram revalidados pelo cache, com dez recibos já existentes. Zero pares reversos pendentes. As dez rechecagens reversas e três verificações fiscais adiadas são limites de trabalho/rechecagem, sem faltar qualquer um dos 23 anexos já conferidos.
- Timer preservado `enabled` e `active`: 08:40, 13:40 e 18:40 America/Sao_Paulo. Próxima execução observada: 17/11 às 18:40 BRT.
- 36 testes completos passaram, incluindo a definição sanitizada do bridge, correspondência, classificação de originais, múltiplas parcelas, conflito preservado, leitura após gravação, repetição idempotente, mudança de fonte, orçamento esgotado sem downloads e backlog de cache dentro do mesmo limite.

Permanece a revisão preexistente `CONFLICTING_FISCAL_ATTACHMENT` no registro fiscal 31 / DDA 28, comprovada no histórico anterior de 16/11. O PDF fiscal divergente não foi sobrescrito. A cópia reversa do espelho DDA desse par foi concluída e verificada normalmente.

SHA-256 do worker, igual no arquivo local, no repositório e na OCI:

    71b2b52348e6aabf22f129b3b53abe622b6cb6fdb74c714346248643a15e2b8f

Backup anterior do código e progresso:

    /var/lib/energetica-whatsapp/dda-fiscal/backups/20261117-reverse/

As definições anteriores do fluxo e os snapshots detalhados permaneceram na pasta privada da tarefa. Configuração de callback, autenticação, registros financeiros completos e payloads bancários não fazem parte deste diretório do repositório. O código de correspondência foi preservado; a mudança do teste antigo apenas atualizou sua URL fictícia para o formato seguro exigido pelo worker em produção.
