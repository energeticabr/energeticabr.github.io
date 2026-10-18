import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createSharePointAttachmentTransport } from '../../../../portal/data/attachments.js';
import { isValidRhidReportDate } from './rhid-attendance-table.js';

function recordDate(value) {
  const raw = String(value ?? '').trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:$|[T ]\d{2}:\d{2})/.exec(raw);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  return iso?.[1] || (br ? `${br[3]}-${br[2]}-${br[1]}` : '');
}

function attendanceRepository(repository, tokenProvider) {
  if (repository) return repository;
  if (typeof tokenProvider !== 'function') throw new Error('A sessão Microsoft é necessária para consultar a justificativa.');
  const transport = createSharePointAttachmentTransport({ tokenProvider, allowedSites: Object.values(SHAREPOINT_SITES), fetch: globalThis.fetch });
  return createSharePointRepository(createGraphClient(tokenProvider, { fetch: globalThis.fetch }), SHAREPOINT_SITES, { attachmentTransport: transport });
}

/** Keep discovery/schema caches within one guarded auth session, never cache item data or ETags. */
export function createAttendanceIrregularityData({ repository, tokenProvider, assertSession = () => {} } = {}) {
  let source;
  const access = () => {
    assertSession();
    return source ||= attendanceRepository(repository, tokenProvider);
  };
  const run = async (operation, input) => {
    const current = access();
    try { return await operation({ ...input, repository: current, assertSession }); }
    catch (error) {
      if (source === current) source = undefined;
      throw error;
    }
  };
  return {
    read: input => run(readAttendanceIrregularity, input),
    save: input => run(saveAttendanceIrregularity, input),
  };
}

async function attendanceItem(repository, id, date) {
  const recordId = String(id ?? '').trim();
  if (!/^\d+$/.test(recordId) || !isValidRhidReportDate(date)) throw new Error('Registro ou data da presença inválidos.');
  const list = await repository.resolveList('personal', ['DESCRITIVOPRESENCA']);
  if (list.status !== 'resolved' || !list.id) throw new Error('A lista DESCRITIVOPRESENCA não está disponível.');
  const item = await repository.getItem('personal', list.id, recordId, '$expand=fields');
  if (String(item?.id) !== recordId || recordDate(item?.fields?.DATA) !== date) {
    throw new Error('A data do registro mudou. Atualize as presenças antes de prosseguir.');
  }
  return { listId: list.id, item, recordId };
}

/** Read the saved note for this exact presence and date, including after an app reload. */
export async function readAttendanceIrregularity({ repository, tokenProvider, assertSession = () => {}, id, date } = {}) {
  const { item } = await attendanceItem(attendanceRepository(repository, tokenProvider), id, date);
  assertSession();
  return String(item.fields?.IRREGULARIDADES ?? '').trim();
}

/** Write one dedicated note field with the record's current version; never change PRESENCA here. */
export async function saveAttendanceIrregularity({ repository, tokenProvider, assertSession = () => {}, id, date, explanation } = {}) {
  const recordId = String(id ?? '').trim();
  const note = String(explanation ?? '').trim();
  if (!/^\d+$/.test(recordId) || !isValidRhidReportDate(date)) throw new Error('Registro ou data da presença inválidos.');
  if (!note || note.length > 4000) throw new Error('Digite uma justificativa de até 4.000 caracteres.');
  repository = attendanceRepository(repository, tokenProvider);
  const list = await repository.resolveList('personal', ['DESCRITIVOPRESENCA']);
  if (list.status !== 'resolved' || !list.id) throw new Error('A lista DESCRITIVOPRESENCA não está disponível.');
  const [columns, item] = await Promise.all([
    repository.getColumns('personal', list.id),
    repository.getItem('personal', list.id, recordId, '$expand=fields'),
  ]);
  const column = columns.find(item => item.name === 'IRREGULARIDADES');
  if (!column?.text?.allowMultipleLines || column.readOnly) throw new Error('A coluna IRREGULARIDADES não está disponível como texto multilinha.');
  if (String(item?.id) !== recordId || recordDate(item?.fields?.DATA) !== date) {
    throw new Error('A data do registro mudou. Atualize as presenças antes de prosseguir.');
  }
  const eTag = item.eTag || item['@odata.etag'] || item['odata.etag'];
  if (!eTag || eTag === '*') throw new Error('Não foi possível confirmar a versão do registro.');
  assertSession();
  await repository.updateItem('personal', list.id, recordId, { IRREGULARIDADES: note }, { eTag });
  assertSession();
  return { id: recordId, date };
}
