import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createPayrollSourceReader, payrollFieldKey } from './payroll-editor-policy.js';
import { normalizePayrollMonth, summarizePayrollPayments } from './supplier-payroll-report-model.js';

const site = 'personal';
const unnamed = 'Fornecedor não informado';
const schema = {
  IDFOLHA: { supplier: ['FORNECEDOR'], month: ['MESREFERENCIA'] },
  FOLHAPGTO: { supplier: ['FORNECEDOR'], type: ['TIPOPGTO', 'TIPOPAGAMENTO'], date: ['DATA'],
    payrollId: ['IDFOLHA'], launchId: ['IDLANCAMENTO'], unitValue: ['VALORUNITARIO'], quantity: ['QTD', 'QUANTIDADE'] },
  LANCAMENTOS: { unitValue: ['VALORUNITARIO'], quantity: ['QTD', 'QUANTIDADE'] },
};
const identity = value => value.normalize('NFC').toLocaleLowerCase('pt-BR');
const abortError = () => new DOMException('Consulta substituída ou cancelada.', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw signal.reason || abortError(); }

// Abort stops waiting even if the repository ignores signals. Always consume its late result.
function abortable(operation, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => { signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason || abortError());
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { checkAbort(signal); return operation(); }).then(
      value => { try { checkAbort(signal); finish(resolve, value); } catch (error) { finish(reject, error); } },
      error => finish(reject, error),
    );
  });
}

function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return String(value).trim();
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['LookupValue', 'Value', 'value']) {
      if (Object.hasOwn(value, key)) {
        const inner = value[key];
        if (inner == null) return '';
        if (typeof inner === 'string' || typeof inner === 'number' && Number.isFinite(inner)) return String(inner).trim();
        break;
      }
    }
  }
  throw new TypeError('Valor SharePoint inválido.');
}
function validId(value, allowBlank = false) {
  const id = scalar(value);
  if (allowBlank && !id) return '';
  if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new TypeError('ID ou vínculo da folha inválido.');
  return id;
}
function resolveSchema(columns, list) {
  if (!Array.isArray(columns)) throw new TypeError('Esquema SharePoint inválido.');
  const dataColumns = columns.filter(c => c && !c.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(c.name || ''));
  return Object.fromEntries(Object.entries(schema[list]).map(([key, aliases]) => {
    const matches = dataColumns.filter(c => aliases.includes(payrollFieldKey(c.name)) || aliases.includes(payrollFieldKey(c.displayName)));
    if (matches.length !== 1 || !matches[0].name) throw new TypeError(`Coluna ${aliases[0]} ausente ou ambígua em ${list}.`);
    return [key, matches[0].name];
  }));
}
function normalizeItem(item, fields, list) {
  const id = validId(item.id);
  const values = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, item.fields[name]]));
  const supplier = scalar(values.supplier);
  if (list === 'IDFOLHA') {
    const month = normalizePayrollMonth(values.month);
    return { sourceSupplier: supplier, row: Object.freeze({ id, supplier: supplier || unnamed, month,
      referenceLabel: month ? `${month.slice(5)}/${month.slice(0, 4)}` : 'Sem referência' }) };
  }
  const date = scalar(values.date);
  if (date) {
    // Validate strictly before exposing either Brazilian or ISO calendar dates.
    normalizePayrollMonth(date);
    if (!/^(?:\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}(?:T.*)?)$/.test(date)) throw new TypeError('Data de pagamento inválida.');
  }
  return Object.freeze({ id, supplier, type: scalar(values.type), date,
    payrollId: validId(values.payrollId, true), launchId: validId(values.launchId, true) });
}

// Keep the existing source reader as financial source truth, but guard its otherwise
// signal-less metadata boundaries and coercions without changing shared policy code.
function guardedSourceReader(repository, signal) {
  let financialFields;
  async function invoke(method, args) {
    checkAbort(signal);
    const result = await repository[method](...args);
    checkAbort(signal);
    return result;
  }
  return createPayrollSourceReader({
    resolveList: (siteKey, aliases) => invoke('resolveList', [siteKey, aliases, { signal }]),
    async getColumns(siteKey, list) {
      const columns = await invoke('getColumns', [siteKey, list, { signal }]);
      checkAbort(signal);
      financialFields = resolveSchema(columns, 'LANCAMENTOS');
      // Remove the same computed mirrors from the columns seen by the source reader.
      return columns.filter(c => c && !c.computed && !/^LinkTitle(?:NoMenu|2)?$/i.test(c.name || ''));
    },
    async getItem(siteKey, list, id, query) {
      const item = await invoke('getItem', [siteKey, list, id, query, { signal }]);
      checkAbort(signal);
      for (const name of Object.values(financialFields)) {
        const value = item?.fields?.[name];
        if (value != null && typeof value !== 'string' && typeof value !== 'number') {
          throw new TypeError('O lançamento contém valores financeiros inválidos.');
        }
      }
      return item;
    },
  }, site);
}

async function readList(repository, list, signal) {
  const resolved = await abortable(() => repository.resolveList(site, [list], { signal }), signal);
  if (resolved?.status !== 'resolved' || !resolved.id) throw new Error(`A lista ${list} não está disponível.`);
  const columns = resolveSchema(await abortable(() => repository.getColumns(site, resolved.id, { signal }), signal), list);
  const query = new URLSearchParams({ $expand: 'fields', $top: '100' }).toString();
  const rows = [], ids = new Set(), cursors = new Set(); let cursor = '';
  for (let index = 0; index < 10_000; index++) {
    const page = await abortable(() => repository.getItemsPage(site, resolved.id, query, {
      signal, pageNumber: index % 100 + 1, maxPages: 100, ...(cursor ? { cursor } : {}),
    }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== 'boolean'
      || page.error || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== 'string') throw new TypeError('Página SharePoint inválida ou incompleta.');
    const next = page.nextLink?.trim() || '';
    if (page.hasMore !== Boolean(next) || page.hasMore && !page.items.length) throw new TypeError('Conclusão da paginação inconsistente.');
    for (const item of page.items) {
      if (!item?.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) throw new TypeError('Página com campos inválidos.');
      const id = validId(item.id);
      if (ids.has(id)) throw new TypeError('ID duplicado na paginação.');
      ids.add(id); rows.push(normalizeItem(item, columns, list));
    }
    if (!page.hasMore) return rows;
    if (cursors.has(next)) throw new TypeError('Cursor repetido: ciclo de paginação.');
    cursors.add(next); cursor = next;
  }
  throw new RangeError('Limite seguro de paginação excedido; nenhum total parcial disponibilizado.');
}

/** Read-only report: two full scans per refresh; launch reads only on detail expansion. */
export function createSupplierPayrollReportData({ tokenProvider, repository: suppliedRepository,
  fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== 'function') throw new TypeError('Sessão Microsoft ativa obrigatória.');
  if (suppliedRepository && ['resolveList', 'getColumns', 'getItemsPage', 'getItem'].some(key => typeof suppliedRepository[key] !== 'function')) {
    throw new TypeError('Repositório SharePoint inválido.');
  }
  // The service and token provider persist for the account/controller session.
  // Bind cancellation per Graph request, never through a shared mutable load signal.
  const repository = suppliedRepository || createSharePointRepository({
    async request(path, options = {}) {
      const { signal } = options;
      checkAbort(signal);
      const graph = createGraphClient(scopes => abortable(() => tokenProvider(scopes, { signal }), signal), { fetch: fetchImpl });
      const result = await abortable(() => graph.request(path, options), signal);
      checkAbort(signal);
      return result;
    },
  }, siteConfig);
  let generation, cache;
  // A global semaphore also bounds overlapping detail calls to four real source operations.
  let activeSources = 0; const waiters = [];
  async function readSource(operation, signal) {
    if (activeSources >= 4) {
      await new Promise((resolve, reject) => {
        const entry = { resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
        const abort = () => { const index = waiters.indexOf(entry); if (index >= 0) waiters.splice(index, 1); reject(signal.reason || abortError()); };
        signal.addEventListener('abort', abort, { once: true }); waiters.push(entry);
      });
    } else activeSources++;
    try { checkAbort(signal); return await operation(); }
    finally { const next = waiters.shift(); if (next) next.resolve(); else activeSources--; }
  }

  async function loadSnapshot({ signal: externalSignal } = {}) {
    checkAbort(externalSignal);
    generation?.abort(abortError());
    const controller = new AbortController(); generation = controller; cache = null;
    const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      const [sheets, payments] = await Promise.all([
        readList(repository, 'IDFOLHA', signal), readList(repository, 'FOLHAPGTO', signal),
      ]);
      checkAbort(signal);
      if (generation !== controller) throw abortError();
      const snapshot = Object.freeze({ complete: true, sheets: Object.freeze(sheets.map(s => s.row)) });
      cache = { controller, sheets: new Map(sheets.map(s => [s.row.id, s])), payments };
      return snapshot;
    } catch (error) { controller.abort(error); throw error; }
    finally { externalSignal?.removeEventListener('abort', abort); }
  }

  async function loadPaymentsForPayrollIds(ids, { signal: externalSignal } = {}) {
    checkAbort(externalSignal);
    const current = cache;
    if (!current) throw new Error('Carregue um snapshot completo antes de consultar os pagamentos.');
    if (!Array.isArray(ids)) throw new TypeError('IDs de folha devem ser um array.');
    const wanted = new Set();
    for (const value of ids) {
      const id = validId(value);
      if (wanted.has(id) || !current.sheets.has(id)) throw new TypeError('ID de folha duplicado ou ausente no snapshot.');
      wanted.add(id);
    }
    const controller = new AbortController(), { signal } = controller;
    const abortExternal = () => controller.abort(externalSignal.reason);
    const abortGeneration = () => controller.abort(current.controller.signal.reason || abortError());
    externalSignal?.addEventListener('abort', abortExternal, { once: true });
    current.controller.signal.addEventListener('abort', abortGeneration, { once: true });
    try {
      checkAbort(current.controller.signal);
      const read = guardedSourceReader(repository, signal);
      const rows = current.payments.filter(p => wanted.has(p.payrollId));
      // Validate every selected supplier before launching any financial reads.
      for (const row of rows) {
        const sheet = current.sheets.get(row.payrollId);
        if (row.supplier && sheet.sourceSupplier && identity(row.supplier) !== identity(sheet.sourceSupplier)) {
          throw new TypeError('Fornecedor do pagamento diverge do fornecedor da folha.');
        }
      }
      const result = [];
      for (let start = 0; start < rows.length; start += 4) {
        result.push(...await Promise.all(rows.slice(start, start + 4).map(async row => {
          const source = row.launchId ? await abortable(() => readSource(
            () => read({ IDLANCAMENTO: row.launchId }, signal), signal,
          ), signal) : {};
          checkAbort(signal);
          const unitValue = source.VALORUNITARIO ?? null, quantity = source.QTD ?? null;
          return Object.freeze({ ...row, supplier: row.supplier || current.sheets.get(row.payrollId).row.supplier,
            unitValue, quantity, totalCents: summarizePayrollPayments([{ unitValue, quantity }]).totalCents });
        })));
      }
      checkAbort(signal);
      if (cache !== current) throw abortError();
      return Object.freeze(result);
    } catch (error) { controller.abort(error); throw error; }
    finally {
      externalSignal?.removeEventListener('abort', abortExternal);
      current.controller.signal.removeEventListener('abort', abortGeneration);
    }
  }
  return Object.freeze({ loadSnapshot, loadPaymentsForPayrollIds });
}
