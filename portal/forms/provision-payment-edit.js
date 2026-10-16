import { provisionChildrenTotal } from './provision-parent-workflow.js';

const PARENT_LIST = ['DESCRITIVOPROVISAO'];
const PAYMENT_DATES = ['DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO', 'PGTOAGENDADO'];
const DATE_FIELDS = ['DATAPREVISTOPGTO', ...PAYMENT_DATES];
const key = value => String(value || '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const blank = value => value == null || String(value).trim() === '';
const id = value => {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d{0,14}$/.test(text)) throw new Error('O vínculo da provisão requer ID positivo.');
  return text;
};
const version = item => {
  const tag = String(item?.eTag || item?.['@odata.etag'] || item?.['odata.etag'] || '').trim();
  if (!tag || tag === '*') throw new Error('A versão ETag da provisão não está disponível.');
  return tag;
};
function field(columns, name, types = ['text']) {
  const matches = columns.filter(column => column?.name && !column.hidden && !column.computed
    && (key(column.name) === name || key(column.displayName) === name));
  const internal = matches.filter(column => key(column.name) === name);
  const selected = internal.length ? internal : matches;
  if (selected.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(selected[0].name)
    || !types.some(type => selected[0][type])) throw new Error(`Metadados únicos de ${name} indisponíveis.`);
  return selected[0].name;
}

function sameValue(actual, expected, date) {
  if (blank(actual) && blank(expected)) return true;
  if (date && !blank(actual) && !blank(expected)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(expected))) return String(actual).slice(0, 10) === String(expected);
    const timestamp = value => Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(String(value)) ? value : `${value}Z`);
    if (Number.isFinite(timestamp(actual)) && timestamp(actual) === timestamp(expected)) return true;
  }
  return String(actual) === String(expected);
}

export function createProvisionPaymentEditor({ repository, siteKey = 'personal', assertSession = () => {} } = {}) {
  const busy = new Set();
  function active(signal) {
    assertSession();
    if (signal?.aborted) throw signal.reason || new DOMException('Sincronização cancelada.', 'AbortError');
  }
  async function read(list, rowId, signal) {
    active(signal);
    const row = await repository.getItem(siteKey, list, rowId, '$expand=fields', signal ? { signal } : {});
    active(signal);
    if (id(row?.id) !== rowId) throw new Error('A identidade do registro mudou.');
    version(row);
    return row;
  }
  async function linked(list, linkName, parentId, signal) {
    const found = [], seen = new Set();
    let cursor = '';
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      active(signal);
      const page = await repository.getItemsPage(siteKey, list, '$expand=fields&$top=100', {
        pageNumber, maxPages: 100, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}),
      });
      active(signal);
      if (!Array.isArray(page?.items) || page.complete === false || page.partial || page.truncated || typeof page.hasMore !== 'boolean') {
        throw new Error('A consulta completa das provisões está indisponível.');
      }
      for (const row of page.items) {
        if (String(row.fields?.[linkName] ?? '').trim() !== parentId) continue;
        const childId = id(row.id);
        if (seen.has(childId)) throw new Error('A consulta retornou provisão duplicada.');
        seen.add(childId);
        found.push(row);
      }
      if (!page.hasMore) {
        if (page.nextLink) throw new Error('Cursor de provisões inconsistente.');
        return found;
      }
      if (typeof page.nextLink !== 'string' || !page.nextLink || seen.has(`cursor:${page.nextLink}`)) {
        throw new Error('A paginação das provisões não retornou cursor único.');
      }
      seen.add(`cursor:${page.nextLink}`);
      cursor = page.nextLink;
    }
    throw new Error('A consulta das provisões excedeu o limite seguro de páginas.');
  }

  async function save({ list, item, fields, signal } = {}) {
    active(signal);
    const childId = id(item?.id);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Informe os campos editados da provisão.');
    if (Object.keys(fields).some(name => ['FILIAL', 'FORNECEDOR', 'DESCRITIVOPROVISAO'].includes(key(name)))) {
      throw new Error('FILIAL, FORNECEDOR e o vínculo devem ser editados em DESCRITIVOPROVISAO.');
    }
    if (busy.has(childId)) throw new Error('Esta provisão já está sendo sincronizada.');
    busy.add(childId);
    try {
      const childList = await repository.resolveList(siteKey, ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'], signal ? { signal } : {});
      active(signal);
      if (childList?.status !== 'resolved' || !childList.id || childList.id !== list?.id) throw new Error('A lista da provisão mudou. Reabra o registro.');
      if (!Object.keys(fields).length && !Object.keys(item.fields || {}).some(name => key(name) === 'DESCRITIVOPROVISAO')) {
        return read(childList.id, childId, signal);
      }
      const childColumns = await repository.getColumns(siteKey, childList.id, signal ? { signal } : {});
      active(signal);
      if (!Array.isArray(childColumns)) throw new Error('Metadados da provisão indisponíveis.');
      const linkName = field(childColumns, 'DESCRITIVOPROVISAO');
      const currentLink = String(item.fields?.[linkName] ?? '').trim();
      const hasAmount = Object.keys(fields).some(name => ['VALORTOTAL', 'QTD', 'FRETE'].includes(key(name)));
      const changedDates = DATE_FIELDS.filter(name => Object.keys(fields).some(candidate => key(candidate) === name));
      let parentList, parentColumns, parentId, parentTotalName, childTotals;
      if (currentLink && (hasAmount || changedDates.length)) {
        parentId = id(currentLink);
        parentList = await repository.resolveList(siteKey, PARENT_LIST, signal ? { signal } : {});
        active(signal);
        if (parentList?.status !== 'resolved' || !parentList.id || parentList.id === childList.id) throw new Error('O descritivo vinculado não está disponível.');
        parentColumns = await repository.getColumns(siteKey, parentList.id, signal ? { signal } : {});
        active(signal);
        if (!Array.isArray(parentColumns)) throw new Error('Metadados do descritivo indisponíveis.');
        parentTotalName = field(parentColumns, 'VALORTOTAL', ['text', 'number', 'currency']);
        childTotals = Object.fromEntries(['QTD', 'VALORTOTAL', 'FRETE'].map(name => [name, field(childColumns, name, ['text', 'number', 'currency'])]));
        await read(parentList.id, parentId, signal);
        const before = await linked(childList.id, linkName, parentId, signal);
        if (!before.some(row => String(row.id) === childId)) throw new Error('A provisão não consta entre os itens vinculados ao descritivo.');
        if (hasAmount) provisionChildrenTotal(before.map(row => String(row.id) === childId
          ? { ...row, fields: { ...row.fields, ...fields } } : row), childTotals);
      }
      const current = await read(childList.id, childId, signal);
      if (String(current.fields?.[linkName] ?? '').trim() !== currentLink) throw new Error('O vínculo da provisão mudou. Reabra o registro.');
      const sameFields = row => Object.entries(fields).every(([name, value]) =>
        sameValue(row.fields?.[name], value, childColumns.some(column => column.name === name && column.dateTime)));
      const matches = sameFields(current);
      if (version(current) !== version(item) && !matches) throw new Error('A provisão mudou. Recarregue antes de editar.');
      if (!matches && Object.keys(fields).length) {
        active(signal);
        try { await repository.updateItem(siteKey, childList.id, childId, fields, { eTag: version(current), ...(signal ? { signal } : {}) }); }
        catch (error) {
          const after = await read(childList.id, childId, signal);
          if (!sameFields(after)) throw error;
        }
      }
      const saved = await read(childList.id, childId, signal);
      if (!sameFields(saved)) {
        throw new Error('A edição da provisão não foi confirmada.');
      }
      if (!parentList) return saved;
      for (let attempt = 0; attempt < 3; attempt++) {
        const parent = await read(parentList.id, parentId, signal);
        const rows = await linked(childList.id, linkName, parentId, signal);
        if (!rows.some(row => String(row.id) === childId)) throw new Error('O vínculo da provisão mudou durante a sincronização.');
        const total = provisionChildrenTotal(rows, childTotals);
        const patch = {};
        if (hasAmount && String(parent.fields?.[parentTotalName] ?? '') !== total) {
          patch[parentTotalName] = parentColumns.find(column => column.name === parentTotalName)?.text ? total : Number(total);
        }
        if (rows.length === 1 && changedDates.length && PAYMENT_DATES.every(name => {
          const column = parentColumns.find(candidate => key(candidate.name) === name && candidate.dateTime);
          return column && blank(parent.fields?.[column.name]);
        })) {
          for (const name of changedDates) {
            const source = childColumns.find(column => key(column.name) === name && column.dateTime);
            const target = parentColumns.find(column => key(column.name) === name && column.dateTime && !column.readOnly);
            if (source && target && !blank(saved.fields?.[source.name])
              && (name === 'DATAPREVISTOPGTO' || blank(parent.fields?.[target.name]))) {
              patch[target.name] = saved.fields[source.name];
            }
          }
        }
        const confirmedTotal = async () => {
          if (!hasAmount) return true;
          const latest = await read(parentList.id, parentId, signal);
          const linkedNow = await linked(childList.id, linkName, parentId, signal);
          if (!linkedNow.some(row => String(row.id) === childId)) throw new Error('O vínculo da provisão mudou durante a conferência.');
          return String(latest.fields?.[parentTotalName] ?? '') === provisionChildrenTotal(linkedNow, childTotals);
        };
        const parentPatchMatches = row => Object.entries(patch).every(([name, value]) =>
          sameValue(row.fields?.[name], value, parentColumns.some(column => column.name === name && column.dateTime)));
        if (!Object.keys(patch).length) {
          if (await confirmedTotal()) return saved;
          if (attempt === 2) throw new Error('O total do descritivo mudou durante a sincronização. Tente novamente.');
          continue;
        }
        active(signal);
        try {
          await repository.updateItem(siteKey, parentList.id, parentId, patch, { eTag: version(parent), ...(signal ? { signal } : {}) });
          const confirmed = await read(parentList.id, parentId, signal);
          if (parentPatchMatches(confirmed)) {
            if (await confirmedTotal()) return saved;
            if (attempt === 2) throw new Error('O total do descritivo mudou durante a sincronização. Tente novamente.');
            continue;
          }
          throw new Error('A sincronização do descritivo não foi confirmada.');
        } catch (error) {
          const confirmed = await read(parentList.id, parentId, signal);
          if (parentPatchMatches(confirmed)) {
            if (await confirmedTotal()) return saved;
            if (attempt < 2) continue;
          }
          if (Number(error?.status) !== 412 || attempt === 2) throw error;
        }
      }
      return saved;
    } finally { busy.delete(childId); }
  }
  return Object.freeze({ save });
}
