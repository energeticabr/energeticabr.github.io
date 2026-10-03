import Decimal from 'decimal.js';
import { linkedReportDecimal, linkedReportText } from './orders-linked-report-data.js';

const ORDER_FIELDS = ['FILIAL', 'FORNECEDOR', 'VALORTOTAL', 'NOTA FISCAL', 'OBS FISCAL', 'CONSTACNO'];
const LAUNCH_FIELDS = ['AGRUPAR', 'FILIAL', 'FORNECEDOR', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE'];
const SUBMIT_ORDER_FIELDS = ['FILIAL', 'FORNECEDOR', 'NOTA FISCAL', 'OBS FISCAL'];
const SUBMIT_LAUNCH_FIELDS = ['AGRUPAR', 'FILIAL', 'FORNECEDOR'];
const key = value => String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Power Fx Trim removes edge spaces and collapses runs of ordinary spaces.
const trim = value => linkedReportText(value).replace(/^ +| +$/g, '').replace(/ +/g, ' ');
const supplier = value => trim(linkedReportText(value).replace(/[\u00a0\n\r]/g, ' ')).toUpperCase();
const empty = value => linkedReportText(value) === '';
const equal = (left, right) => linkedReportText(left).toUpperCase() === linkedReportText(right).toUpperCase();
const abort = signal => { if (signal?.aborted) throw signal.reason || new DOMException('A consulta foi cancelada.', 'AbortError'); };

function mapping(columns, labels, listName) {
  return new Map(labels.map(label => {
    const matches = [...new Set(columns.filter(column => key(column.name) === key(label)
      || key(column.displayName || column.label || column.name) === key(label)).map(column => column.name))];
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0])) throw new Error(`A coluna ${label} de ${listName} não pôde ser comprovada para liberar STATUS.`);
    return [label, matches[0]];
  }));
}

function submitReasons(draft, active) {
  const reasons = [];
  if (!active.length) reasons.push('Vincule pelo menos um lançamento ativo ao pedido.');
  if (empty(draft.FILIAL) || active.some(row => !equal(row.fields.FILIAL, draft.FILIAL))) reasons.push('Preencha a filial do pedido e confira a filial de todos os lançamentos ativos.');
  const expectedSupplier = supplier(draft.FORNECEDOR);
  const distinct = new Set(active.map(row => supplier(row.fields.FORNECEDOR)));
  const mismatch = active.some(row => supplier(row.fields.FORNECEDOR) !== expectedSupplier);
  if (empty(draft.FORNECEDOR) || mismatch && !(distinct.size > 1 && expectedSupplier === 'DIVERSOS')) {
    reasons.push('Confira o fornecedor do pedido e dos lançamentos; DIVERSOS exige mais de um fornecedor distinto.');
  }
  const fiscal = trim(draft['NOTA FISCAL']).toUpperCase();
  if (!fiscal || fiscal === 'PENDENTE') reasons.push('Informe uma situação de nota fiscal diferente de PENDENTE.');
  if (!trim(draft['OBS FISCAL'])) reasons.push('Preencha a observação fiscal.');
  return reasons;
}

export function evaluateForm43Status({ orderId, draft, active, attachmentCount = 0 }) {
  active = active.filter(row => linkedReportText(row.fields.AGRUPAR) === String(orderId));
  const reasons = submitReasons(draft, active);
  const amount = active.reduce((sum, row) => sum.plus(linkedReportDecimal(row.fields.QUANTIDADE, 'QUANTIDADE', row.id)
    .times(linkedReportDecimal(row.fields['VALOR UNITÁRIO'], 'VALOR UNITÁRIO', row.id))
    .plus(linkedReportDecimal(row.fields.FRETE, 'FRETE', row.id))), new Decimal(0));
  if (empty(draft.VALORTOTAL)) reasons.push('Informe o valor total do pedido.');
  else if (amount.minus(linkedReportDecimal(draft.VALORTOTAL, 'VALORTOTAL', orderId)).abs().greaterThan('0.01')) {
    reasons.push('O valor do pedido deve conferir com os lançamentos ativos, com diferença máxima de um centavo.');
  }
  const fiscal = trim(draft['NOTA FISCAL']).toUpperCase();
  if (fiscal === 'SUBMETIDO' && attachmentCount < 1) reasons.push('A nota fiscal SUBMETIDO exige pelo menos um anexo existente no pedido.');
  if (!['SIM', 'DISPENSADO'].includes(trim(draft.CONSTACNO).toUpperCase())) reasons.push('Informe CNO como SIM ou DISPENSADO.');
  return Object.freeze({ editable: reasons.length === 0, reasons: Object.freeze(reasons) });
}

/** Form43 uses distinct STATUS DisplayMode and APROVADO SUBMETER conditions. */
export function createForm43StatusPolicy({ repository, siteKey, orderId, orderColumns, statusFieldName, orderListId }) {
  const launchContracts = new Map();
  async function readActive(signal, labels = LAUNCH_FIELDS) {
    abort(signal);
    const contractKey = labels.join('|');
    if (!launchContracts.has(contractKey)) {
      const list = await repository.resolveList(siteKey, ['LANCAMENTOS'], signal ? { signal } : {});
      abort(signal);
      if (list?.status !== 'resolved' || !list.id) throw new Error('A lista LANCAMENTOS não está disponível para conferir STATUS.');
      const columns = await repository.getColumns(siteKey, list.id, signal ? { signal } : {});
      abort(signal);
      if (!Array.isArray(columns)) throw new Error('Os metadados de LANCAMENTOS estão indisponíveis.');
      launchContracts.set(contractKey, { id: list.id, mapping: mapping(columns, labels, 'LANCAMENTOS') });
    }
    const { id, mapping: names } = launchContracts.get(contractKey);
    const query = `$select=id&$expand=fields($select=${[...names.values()].join(',')})&$filter=fields/${names.get('AGRUPAR')} eq '${orderId}'&$top=100`;
    const rows = new Map(); const seen = new Set(); let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      abort(signal);
      const page = await repository.getItemsPage(siteKey, id, query, { pageNumber, maxPages: 100,
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) });
      abort(signal);
      if (!Array.isArray(page?.items)) throw new Error('A resposta de LANCAMENTOS é inválida; STATUS permanece bloqueado.');
      for (const item of page.items) {
        if (!item?.fields || !/^\d{1,15}$/.test(String(item.id ?? ''))) throw new Error('Um lançamento não pôde ser identificado; STATUS permanece bloqueado.');
        const fields = Object.fromEntries([...names].map(([label, name]) => [label, item.fields[name] ?? item.fields[label] ?? null]));
        if (linkedReportText(fields.AGRUPAR) === String(orderId)) rows.set(String(item.id), Object.freeze({ id: String(item.id), fields: Object.freeze(fields) }));
      }
      if (page.hasMore !== true) return Object.freeze([...rows.values()]);
      if (typeof page.nextLink !== 'string' || !page.nextLink || seen.has(page.nextLink)) throw new Error('A paginação dos lançamentos está incompleta; STATUS permanece bloqueado.');
      seen.add(page.nextLink); cursor = page.nextLink;
    }
    throw new Error('Os lançamentos excederam o limite de páginas; STATUS permanece bloqueado.');
  }
  function canonical(fields, labels = ORDER_FIELDS) {
    const names = mapping(orderColumns, labels, 'NOTASPENDENTES');
    return Object.fromEntries([...names].map(([label, name]) => [label, fields[name] ?? null]));
  }
  let cachedActive;
  let cachedAttachments;
  async function evaluate(fields, { signal, refresh = false } = {}) {
    abort(signal);
    const draft = canonical(fields);
    let attachmentRequest = Promise.resolve(0);
    if (trim(draft['NOTA FISCAL']).toUpperCase() === 'SUBMETIDO') {
      if (typeof repository.listAttachments !== 'function') throw new Error('A consulta dos anexos está indisponível; STATUS permanece bloqueado.');
      if (refresh || !cachedAttachments) {
        const request = Promise.resolve(repository.listAttachments(siteKey, orderListId, orderId, { refresh: true, ...(signal ? { signal } : {}) }))
          .then(files => {
            if (!Array.isArray(files)) throw new Error('A resposta de anexos é inválida; STATUS permanece bloqueado.');
            return files.length;
          }).catch(error => { if (cachedAttachments === request) cachedAttachments = null; throw error; });
        cachedAttachments = refresh ? null : request;
        attachmentRequest = request;
      } else attachmentRequest = cachedAttachments;
    }
    let activeRequest;
    if (refresh || !cachedActive) {
      const request = readActive(signal).catch(error => { if (cachedActive === request) cachedActive = null; throw error; });
      cachedActive = refresh ? null : request;
      activeRequest = request;
    } else activeRequest = cachedActive;
    const [active, attachmentCount] = await Promise.all([activeRequest, attachmentRequest]);
    abort(signal);
    return Object.freeze({ [statusFieldName]: evaluateForm43Status({ orderId, draft, active, attachmentCount }) });
  }
  function assertApprovalDate(fields) {
    if (trim(fields[statusFieldName]).toUpperCase() !== 'APROVADO') return;
    const names = mapping(orderColumns, ['DATAPGTOEFETUADO'], 'NOTASPENDENTES');
    if (!linkedReportText(fields[names.get('DATAPGTOEFETUADO')]).trim()) {
      throw new Error('Para aprovar, informe a data de submissão à auditoria (DATAPGTOEFETUADO).');
    }
  }
  async function assertSubmit(fields, { signal } = {}) {
    if (trim(fields[statusFieldName]).toUpperCase() !== 'APROVADO') return;
    assertApprovalDate(fields);
    const draft = canonical(fields, SUBMIT_ORDER_FIELDS);
    // A retained APROVADO value uses the button's basic conditions, without the
    // monetary, CNO or attachment-count rules exclusive to STATUS DisplayMode.
    cachedActive = null;
    const active = await readActive(signal, SUBMIT_LAUNCH_FIELDS);
    const reasons = submitReasons(draft, active);
    if (reasons.length) throw new Error(`Não é possível submeter o pedido APROVADO: ${reasons.join(' ')}`);
  }
  return Object.freeze({ evaluate, assertApprovalDate, assertSubmit });
}
