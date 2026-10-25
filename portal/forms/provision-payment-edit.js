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
  const pendingRepairs = new Map();
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
  async function allRows(list, signal) {
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

  async function linked(list, linkName, parentId, signal) {
    return (await allRows(list, signal)).filter(row => String(row.fields?.[linkName] ?? '').trim() === parentId);
  }

  async function parentSource(signal) {
    active(signal);
    const list = await repository.resolveList(siteKey, PARENT_LIST, signal ? { signal } : {});
    active(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error('Os descritivos de provisão não estão disponíveis.');
    return list;
  }

  async function prepareColumns({ columns, rawColumns, item, signal }) {
    if (!rawColumns.some(column => key(column.name) === 'DESCRITIVOPROVISAO')) return columns;
    const name = field(rawColumns, 'DESCRITIVOPROVISAO');
    if (rawColumns.find(column => column.name === name).readOnly) return columns;
    const list = await parentSource(signal);
    const parents = (await allRows(list.id, signal)).sort((a,b) => Number(b.id) - Number(a.id));
    const choices = parents.map(row => id(row.id));
    const optionLabels = Object.fromEntries(parents.map(row => [id(row.id),
      [`ID ${row.id}`, row.fields?.FORNECEDOR, row.fields?.OBS].filter(value => !blank(value)).join(' · ')]));
    const current = String(item.fields?.[name] ?? '').trim();
    if (current && !choices.includes(current)) {
      choices.push(id(current));
      optionLabels[current] = `ID ${current} · vínculo atual`;
    }
    const descriptor = { name, label: 'Descritivo da provisão', control: 'select',
      editable: true, readOnly: false, disabled: false, hidden: false, required: Boolean(current),
      choices, optionLabels, powerApps: { closed: true, preserveCurrentValue: true } };
    return [...columns.filter(column => key(column.name) !== 'DESCRITIVOPROVISAO'), descriptor];
  }

  async function synchronizeTotals(record, { signal, expectedLink, skipMissing = false } = {}) {
    const { parents, parentIds, childList, childId, linkName, totalName, amounts, parentColumns } = record;
    const parent = async parentId => {
      try { return await read(parents.id,parentId,signal); }
      catch (error) { if (skipMissing && Number(error?.status) === 404) return null; throw error; }
    };
    const totalsNow = async () => {
      const rows = await allRows(childList.id, signal);
      if (expectedLink !== undefined) {
        const child = rows.find(row => id(row.id) === childId);
        if (!child || String(child.fields?.[linkName] ?? '').trim() !== expectedLink) throw new Error('O vínculo mudou durante a sincronização dos descritivos.');
      }
      return new Map(parentIds.map(parentId => [parentId, provisionChildrenTotal(rows.filter(row => String(row.fields?.[linkName] ?? '').trim() === parentId), amounts)]));
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const parentId of parentIds) {
        const current = await parent(parentId);
        if (!current) continue;
        const total = (await totalsNow()).get(parentId);
        if (String(current.fields?.[totalName] ?? '') === total) continue;
        const patch = { [totalName]: parentColumns.find(column => column.name === totalName).text ? total : Number(total) };
        active(signal);
        try { await repository.updateItem(siteKey,parents.id,parentId,patch,{eTag:version(current),...(signal?{signal}:{})}); }
        catch (error) {
          const confirmed = await parent(parentId);
          if (!confirmed) continue;
          if (String(confirmed.fields?.[totalName] ?? '') !== total && Number(error?.status) !== 412) throw error;
        }
      }
      const totals = await totalsNow();
      let confirmed = true;
      for (const parentId of parentIds) {
        const current = await parent(parentId);
        if (current && String(current.fields?.[totalName] ?? '') !== totals.get(parentId)) confirmed = false;
      }
      if (confirmed) return;
    }
    throw new Error('Os totais dos descritivos não foram confirmados. Tente salvar novamente para concluir a sincronização.');
  }

  async function destinationMissing(record, signal) {
    try { await read(record.parents.id,record.targetId,signal); return false; }
    catch (error) { if (Number(error?.status) === 404) return true; throw error; }
  }

  async function repair(record, signal) {
    let restored = false;
    if (await destinationMissing(record,signal)) {
      const current = await read(record.childList.id,record.childId,signal);
      if (String(current.fields?.[record.linkName] ?? '').trim() === record.targetId && record.matches(current)) {
        // Compensate only our still-current fields, never a later user's move.
        if (record.currentLink) await read(record.parents.id,id(record.currentLink),signal);
        active(signal);
        try { await repository.updateItem(siteKey,record.childList.id,record.childId,record.original,{eTag:version(current),...(signal?{signal}:{})}); }
        catch (error) { if (!record.matchesOriginal(await read(record.childList.id,record.childId,signal))) throw error; }
        if (!record.matchesOriginal(await read(record.childList.id,record.childId,signal))) throw new Error('Não foi possível confirmar a restauração do vínculo anterior.');
        restored = true;
      }
    }
    // Historical repair is independent of where another session moved the child.
    // A deleted parent has no remaining total to patch; other read errors fail.
    await synchronizeTotals(record,{signal,skipMissing:true});
    pendingRepairs.delete(record.childId);
    return { restored, current:await read(record.childList.id,record.childId,signal) };
  }

  async function relink({ childList, childColumns, childId, item, fields, linkName, currentLink, targetId, signal }) {
    const parents = await parentSource(signal);
    if (parents.id === childList.id) throw new Error('A lista do descritivo não corresponde à origem esperada.');
    const parentColumns = await repository.getColumns(siteKey, parents.id, signal ? { signal } : {});
    active(signal);
    if (!Array.isArray(parentColumns)) throw new Error('Metadados do descritivo indisponíveis.');
    const totalName = field(parentColumns, 'VALORTOTAL', ['text', 'number', 'currency']);
    const amounts = Object.fromEntries(['QTD','VALORTOTAL','FRETE'].map(name => [name, field(childColumns,name,['text','number','currency'])]));
    const parentIds = [...new Set([...(currentLink ? [id(currentLink)] : []), targetId])];
    for (const parentId of parentIds) await read(parents.id, parentId, signal);
    const current = await read(childList.id, childId, signal);
    const equal = (row,values) => Object.entries(values).every(([name,value]) => sameValue(row.fields?.[name],value,
      childColumns.some(column => column.name === name && column.dateTime)));
    const matches = row => equal(row,fields);
    const liveLink = String(current.fields?.[linkName] ?? '').trim();
    if (liveLink !== currentLink && !(liveLink === targetId && matches(current))) throw new Error('O vínculo da provisão mudou. Reabra o registro.');
    if (version(current) !== version(item) && !matches(current)) throw new Error('A provisão mudou. Recarregue antes de editar.');
    const before = await allRows(childList.id, signal);
    const listed = before.find(row => id(row.id) === childId);
    if (!listed || String(listed.fields?.[linkName] ?? '').trim() !== liveLink) throw new Error('O vínculo da provisão mudou durante a consulta.');
    const projected = before.map(row => id(row.id) === childId ? { ...row, fields: { ...current.fields, ...fields } } : row);
    for (const parentId of parentIds) provisionChildrenTotal(projected.filter(row => String(row.fields?.[linkName] ?? '').trim() === parentId), amounts);
    // The child scan is asynchronous: prove destination/source existence again
    // at the actual write boundary, not just before starting that scan.
    for (const parentId of parentIds) await read(parents.id,parentId,signal);
    const original = Object.fromEntries(Object.keys(fields).map(name=>[name,item.fields?.[name] ?? null]));
    const record = {parents,parentIds,childList,childId,linkName,targetId,currentLink,totalName,amounts,parentColumns,
      original,matches,matchesOriginal:row=>equal(row,original)};
    pendingRepairs.set(childId,record);
    try {
      if (!matches(current)) {
        active(signal);
        try { await repository.updateItem(siteKey,childList.id,childId,fields,{eTag:version(current),...(signal?{signal}:{})}); }
        catch (error) { if (!matches(await read(childList.id,childId,signal))) throw error; }
      }
      const saved = await read(childList.id, childId, signal);
      if (!matches(saved)) throw new Error('A nova vinculação da provisão não foi confirmada.');
      await synchronizeTotals(record,{signal,expectedLink:targetId});
      const confirmed = await read(childList.id,childId,signal);
      if (!matches(confirmed)) throw new Error('O vínculo da provisão mudou durante a conferência.');
      await read(parents.id,targetId,signal);
      pendingRepairs.delete(childId);
      return confirmed;
    } catch (error) {
      if (await destinationMissing(record,signal)) {
        const outcome = await repair(record,signal);
        if (outcome.restored) throw new Error('O descritivo de destino foi removido. O vínculo anterior foi restaurado; reabra o editor e selecione outro descritivo.');
      }
      throw error;
    }
  }

  async function save({ list, item, fields, signal } = {}) {
    active(signal);
    const childId = id(item?.id);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Informe os campos editados da provisão.');
    if (Object.keys(fields).some(name => ['FILIAL', 'FORNECEDOR'].includes(key(name)))) {
      throw new Error('FILIAL e FORNECEDOR devem ser editados em DESCRITIVOPROVISAO.');
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
      if (pendingRepairs.has(childId)) {
        const outcome = await repair(pendingRepairs.get(childId),signal);
        if (outcome.restored) throw new Error('O descritivo de destino foi removido. O vínculo anterior foi restaurado; reabra o editor.');
        const matches = Object.entries(fields).every(([name,value]) => sameValue(outcome.current.fields?.[name],value,
          childColumns.some(column=>column.name===name&&column.dateTime)));
        if (matches) return outcome.current;
        if (version(item) !== version(outcome.current)) throw new Error('O vínculo ou os dados da provisão mudaram. Os totais anteriores foram reconciliados; reabra o registro.');
      }
      if (Object.hasOwn(fields,linkName)) {
        const targetId = id(fields[linkName]);
        if (targetId !== currentLink) return await relink({ childList,childColumns,childId,item,fields:{...fields,[linkName]:targetId},linkName,currentLink,targetId,signal });
      }
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
  return Object.freeze({ save, prepareColumns });
}
