export const SEFAZ_SOURCES = Object.freeze({NFE:'NF-e', CTE:'CT-e', NFSE:'NFS-e nacional'});
export const isSefazRequestId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export const isSefazTerminal = status => ['succeeded','partial','failed'].includes(status);
const statuses = ['queued','running','waiting','succeeded','failed'];
const codes = ['COOLDOWN','WORKER_UNAVAILABLE','SYNC_FAILED','DELIVERY_PENDING','BUSY','INCOMPLETE'];
const utc = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

/** Fail closed on incomplete/corrupt receipts and never persist fiscal payloads. */
export function validateSefazReceipt(value) {
  if (!isSefazRequestId(value?.requestId) || ![...statuses,'partial'].includes(value.status)
    || !utc(value.startedUtc) || !value.sources || typeof value.sources !== 'object'
    || Object.keys(value.sources).sort().join(',') !== 'CTE,NFE,NFSE') throw Error('A VM não confirmou a consulta fiscal.');
  const result = {requestId:value.requestId,status:value.status,startedUtc:value.startedUtc,sources:{}};
  if (isSefazTerminal(value.status)) {
    if (!utc(value.completedUtc)) throw Error('Conclusão fiscal sem data confirmada.');
    result.completedUtc=value.completedUtc;
  }
  for (const key of Object.keys(SEFAZ_SOURCES)) {
    const source=value.sources[key];
    if (!source || !statuses.includes(source.status)
      || (source.status === 'succeeded' && source.code !== undefined)
      || (source.documents !== undefined && (!Number.isSafeInteger(source.documents) || source.documents < 0))
      || (source.createdItemIds !== undefined && (!Array.isArray(source.createdItemIds)
        || source.createdItemIds.some(id => !Number.isSafeInteger(id) || id <= 0)))
      || (source.code !== undefined && !codes.includes(source.code))
      || (source.nextAllowedAt !== undefined && !utc(source.nextAllowedAt))) throw Error('Progresso fiscal inválido.');
    result.sources[key]={status:source.status};
    for (const field of ['documents','code','nextAllowedAt']) if (source[field] !== undefined) result.sources[key][field]=source[field];
    if (source.createdItemIds !== undefined) result.sources[key].createdItemIds=[...new Set(source.createdItemIds)];
  }
  if (value.status === 'succeeded' && Object.values(result.sources).some(source=>source.status !== 'succeeded')) throw Error('Consulta fiscal ainda não concluída nas três fontes.');
  return result;
}

export function sefazSourceSummary(source) {
  const labels={queued:'na fila',running:'consultando',waiting:'aguardando',succeeded:'concluída',failed:'não concluída'};
  let text=labels[source?.status] || 'aguardando';
  if (source?.code === 'COOLDOWN') text='aguardando o intervalo obrigatório da fonte fiscal';
  if (source?.code === 'WORKER_UNAVAILABLE') text='aguardando o computador responsável ficar disponível';
  if (source?.code === 'DELIVERY_PENDING') text='entrega ao SharePoint ainda não confirmada';
  if (source?.code === 'BUSY') text='aguardando a consulta que já está em execução';
  if (source?.code === 'SYNC_FAILED') text='consulta ou entrega não concluída';
  if (source?.nextAllowedAt) text+=` — próxima tentativa a partir de ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(source.nextAllowedAt))}`;
  if (source?.documents !== undefined) text+=` · ${source.documents} documento(s) processado(s)`;
  return text;
}

export function sefazProgress(receipt) {
  return Object.entries(SEFAZ_SOURCES).map(([key,label])=>`${label}: ${sefazSourceSummary(receipt.sources?.[key])}`).join('\n');
}
