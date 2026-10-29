# Engine durável CT-e e NFS-e

`src/AuxiliaryFiscal.psm1` fornece execução e retomada independentes das fontes `CTE` e `NFSE`. Não modifica o cursor, o estado ou as pastas de NF-e. A integração com o worker principal deve chamar o ciclo auxiliar **antes** do preflight/cooldown NF-e, para que uma espera da NF-e não impeça esses serviços.

## Contratos públicos

```powershell
Invoke-AuxiliaryFiscalSource `
  -Source CTE `
  -Config $config `
  -DataPath $sourceDataPath `
  -Slot '2026-10-29-09' `
  -Now $now `
  -MaxBatches 20 `
  -WorkerConfig $workerConfig

Invoke-AuxiliaryFiscalScheduledCycle `
  -Config $config `
  -WorkerConfig $workerConfig `
  -DataRoot $companyDataRoot `
  -Now $now
```

Esses exemplos descrevem chamadas operacionais reais. A opção `-StageOnly` faz staging durável sem entrega ao SharePoint; não é uma simulação de rede. Se houver `pending-response.json`, reprocessa-o; se não houver cache/outbox e a consulta estiver autorizada pelo estado, pode efetuar uma consulta. Após staging, devolve `STAGED` sem concluir o slot como entregue. Para testes sem rede, usar os pontos de injeção abaixo.

`Invoke-AuxiliaryFiscalSource` aceita:

| Parâmetro | Contrato |
|---|---|
| `Source` | `CTE` ou `NFSE` |
| `Config` | Configuração da empresa usada pelo conector oficial |
| `DataPath` | Pasta exclusiva daquela empresa/ambiente/fonte |
| `Slot` | Horário devido no formato `yyyy-MM-dd-HH`, calendário BRT |
| `Now` | `DateTimeOffset` usado nas decisões e evidências da invocação |
| `Clock` | Scriptblock opcional `() -> DateTimeOffset` para teste determinístico; padrão `Now + Stopwatch.Elapsed` |
| `MaxBatches` | Máximo de páginas de resposta processadas por invocação; padrão 20, intervalo 1–200 |
| `StageOnly` | Conserva resultados localmente, sem chamar `SendBatch` |
| `WorkerConfig` | `flowId`, `environmentId` e opcional `notificationRoot` para entrega padrão |
| `Request` | Scriptblock `(Config, LastNsu) -> string` de resposta bruta |
| `Parse` | Scriptblock `(Body, CompanyCnpj) -> batch` normalizado |
| `Scope` | Scriptblock `(Document, Evidence, MinimumIssueDate, Now) -> disposition` |
| `SendBatch` | Scriptblock `(Documents[]) -> receipt` |

Sem injeção, CT-e usa `Invoke-CteDistribution`/`ConvertFrom-CteDistributionResponse`; NFS-e usa `Invoke-NfseDistribution`/`ConvertFrom-NfseDistributionResponse`. Escopo usa `Get-FiscalDocumentScopeDisposition` de `FiscalDocuments.psm1`. A entrega carrega `FlowTransport.psm1` e chama `Send-SefazBatch` com os mesmos `flowId`/`environmentId` da configuração do worker. O `NotificationRoot` padrão continua `%LOCALAPPDATA%\Energetica\SefazLive\notifications`, a fila existente. Os módulos de transporte/autenticação não são chamados para interpretar cache ou fazer staging.

A função retorna `source`, `status`, `lastNsu`, `lastCompletedSlot`, `pendingSlot` e contadores `requests`, `staged`, `delivered`, `unhandled`. Estados retornados: `STAGED`, `COMPLETED`, `ALREADY_COMPLETED`, `COOLDOWN`, `PAGE_LIMIT`, `REJECTED` ou `LOCK_BUSY`. Falhas lançam apenas códigos locais `AUX_*`, sem repassar mensagens externas potencialmente sensíveis.

`Invoke-AuxiliaryFiscalScheduledCycle` recebe os parâmetros do exemplo e também `MaxBatches` e `SourceInvoker` opcional. Este último é um scriptblock com parâmetros nomeados `Source`, `Config`, `DataPath`, `Slot`, `WorkerConfig`, `Now`, `MaxBatches`, permitindo verificar o scheduler sem rede. O resultado contém `slot` e `results[]`; cada fonte falha de forma isolada, com `status='FAILED'` e código sanitizado, sem impedir a outra.

## Pastas e estado

O `DataRoot` padrão do scheduler é:

```text
%LOCALAPPDATA%\Energetica\SefazAuxLive\38626750000146-1\
  CTE\
  NFSE\
```

Cada fonte possui:

| Caminho | Finalidade |
|---|---|
| `worker.lock` | Lock exclusivo de arquivo, mantido durante a invocação |
| `state.json` | Cursor e controle de rodada/cooldown |
| `pending-response.json` | Resposta recebida, ainda não totalmente processada |
| `raw/*.json` | Journal original por tentativa, inclusive respostas idênticas em horários distintos |
| `outbox/*.json` | Documentos prontos, ainda sem ACK exato |
| `archive/*.json` | Documentos com entrega confirmada |
| `scope-excluded/*.json` | Emissão anterior ao corte |
| `scope-pending-date/*.json` | Evento sem emissão comprovada ou emissão futura |
| `unhandled/*.json` | XML durável fora do escopo fiscal tratado |
| `unhandled-pending/*.json` | XML que exige interpretação futura |
| `logs/worker.jsonl` | Somente horário, fonte, códigos e contagem de documentos |

Journal aceito, inclusive o criado pela primeira coleta controlada:

```json
{
  "previousNsu": "000000000000000",
  "requestedAt": "2026-10-29T15:00:00.0000000+00:00",
  "body": "resposta bruta completa"
}
```

Estado mínimo compatível:

```json
{
  "version": 1,
  "source": "CTE",
  "lastNsu": "000000000000000",
  "maxNsu": null,
  "status": "REQUEST_RESERVED",
  "nextAllowedAt": "2026-10-29T16:05:00.0000000+00:00",
  "lastCompletedSlot": null,
  "pendingSlot": "2026-10-29-09"
}
```

A engine acrescenta `hasMore` e `awaitingCompletion`. O primeiro indica continuidade já comprovada pela resposta aceita; o segundo conserva a conclusão ainda pendente mesmo quando uma falha operacional altera `status`. Uma nova reserva zera ambos antes da consulta; assim, uma continuação que falha na rede não usa `hasMore` antigo para contornar a espera. `serverNsuHint`, quando presente, é apenas evidência separada de rejeição; nunca altera `lastNsu` confirmado.

Cada reserva e `requestedAt` usam hora atualizada, somando o tempo monotônico já transcorrido ao `Now` inicial. Comparação de cooldown e novas esperas após conclusão/rejeição também usam essa hora fresca. Renderização ou entrega demoradas entre páginas não reduzem os 65 minutos de proteção da tentativa seguinte. O scheduler acrescenta ao `Now` da segunda fonte o tempo gasto na primeira; o calendário do slot e o corte de emissão continuam independentes desse controle.

`Write-AtomicJson`, já existente em `Sefaz.psm1`, persiste journals, documentos e estado. O lock usa `FileShare.None`; a presença do arquivo após o fechamento não significa lock ativo. Uma segunda instância recebe `LOCK_BUSY`.

## Ordem durável de trabalho

1. Adquirir lock e ler estado; havendo resposta pendente, reprocessá-la antes de qualquer nova consulta, mesmo durante cooldown.
2. Conservar uma cópia do journal em `raw`, interpretar e validar identidades NSU/SHA e sequência. Resposta inválida mantém `pending-response.json` e o cursor confirmado.
3. Persistir todos os documentos, inclusive `unhandledDocuments`, nas pastas correspondentes. Somente depois gravar o novo cursor e remover o journal pendente. Replay após interrupção é idempotente por ID/hash; documentos já arquivados não voltam para envio.
4. Reavaliar escopo e entregar a outbox, independentemente do cooldown de consultas. Falha de SharePoint ou ACK mantém a outbox e impede nova consulta naquela retomada.
5. Com outbox confirmada e resposta esgotada, concluir o `pendingSlot` original e definir espera conservadora de 3.900 segundos. Havendo saldo aceito, continuar a próxima página após persistência/entrega, até `MaxBatches`.
6. Antes de cada nova consulta, persistir `REQUEST_RESERVED`, `pendingSlot` e `nextAllowedAt=Now+65min`. Falha de rede conserva essa reserva. Só depois do retorno gravar `pending-response.json`.

CT-e aceita continuidade em `138` quando `lastNsu<maxNsu`; `137` ou `138` esgotado conclui após entrega. `656`/outra rejeição não confirma cursor nem slot e exige espera. NFS-e usa `hasMore` do parser; resposta vazia sem `lastNsu` conserva o cursor anterior. Cursores NFS-e são strings inteiras int64 de até 19 dígitos, sem conversão para ponto flutuante.

Um tipo fora de escopo não é publicado como CT-e/NFS-e nem contado como entregue. Seu XML/base64/hash e os metadados retornados pelo parser são preservados em fila própria antes do cursor. Interpretação de uma nova modalidade requer atualizar o parser e reprocessar explicitamente essa fila/raw; a engine não inventa campos fiscais.

## Escopo e confirmação

O corte padrão é `2026-10-01`, com prioridade para `Config.minimumIssueDate` e depois `WorkerConfig.minimumIssueDate`. A evidência de escopo inclui o lote atual e documentos de `archive`, `outbox`, `scope-excluded` e `scope-pending-date`. Evento pode usar a emissão do XML completo relacionado, inclusive quando está no mesmo lote. Somente `READY` entra na outbox; `BEFORE_SCOPE` fica excluído, e `PENDING_DATE`/`FUTURE_DATE` aguardam evidência sem bloquear o cursor de distribuição.

Cada envio contém até dez documentos e orçamento conservador de 1.500.000 bytes, reservando espaço para o envelope. O leitor próprio da outbox mantém a ordenação int64 e suporta IDs de 15–19 dígitos de NSU; o helper antigo de confirmação aceitava somente 15. Documento individual acima do limite permanece durável e gera `AUX_DOCUMENT_TOO_LARGE`, sem consulta adicional.

O recibo precisa conter `source='SEFAZ'` e `acknowledgedIds` com **exatamente todos** os IDs enviados, sem duplicados, ausentes ou extras. Só depois da validação integral os arquivos daquele lote são movidos para `archive`. O fluxo remoto continua responsável pela idempotência fiscal por chave e pelo recibo confirmado.

## Horários e isolamento

O scheduler calcula o último horário devido em `America/Sao_Paulo`/`E. South America Standard Time`. Usa `Config.scheduleHours`, depois `WorkerConfig.scheduleHours`, ou `[9,15,20]`. Antes das 09h, o último horário é o das 20h da véspera. Um slot já concluído não inicia nova rodada; outbox, journal e pendências de data continuam sendo retomados. Se uma rodada antiga ainda estiver pendente, sua conclusão conserva o slot original.

As fontes possuem locks, cursores, caixas de saída, journals e cooldowns separados. O ciclo tenta ambas mesmo quando uma lança erro. Não há dependência do estado operacional da NF-e.

## Testes

```powershell
pwsh -NoProfile -File tests/AuxiliaryFiscal-Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/AuxiliaryFiscal-Tests.ps1
```

69 asserções offline abrangem staging/cache/cooldown, reserva antes da consulta, continuidade e falha na página seguinte, relógio fresco após atrasos simulados de 10/20 minutos, recuperação de parser, journals idênticos separados, ACK exato, pacote 10+1 e limite de bytes, NSU int64, unhandled, rejeição/hint, corte/eventos/futuro, lock e isolamento/calendário do scheduler. Há integração sintética usando os módulos reais CT-e e FiscalDocuments, com Request e Send substituídos. Nenhuma consulta governamental, entrega SharePoint ou mensagem real é executada pelos testes.
