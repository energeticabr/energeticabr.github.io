import { contractorEmploymentDate, validateContractorEmploymentDraft } from './contractor-employment.js';

const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const key = value => text(value).trim().toLocaleUpperCase('pt-BR');
const etag = item => String(item?.eTag || item?.['@odata.etag'] || '').trim();
const rhDates = ['DATAADMISSAO', 'DATADESLIGAMENTO'];
const conflict = message => Object.assign(new Error(message), { code: 'CONTRACTOR_EMPLOYMENT_DIVERGED' });
function id(value) {
  const result = String(value ?? '');
  if (!/^[1-9]\d*$/.test(result) || !Number.isSafeInteger(Number(result))) throw new Error('ID de funcionário ou fornecedor inválido.');
  return result;
}
function equal(name, a, b) {
  return rhDates.includes(name) ? contractorEmploymentDate(a) === contractorEmploymentDate(b) : text(a) === text(b);
}
function matches(item, fields) { return Object.entries(fields).every(([name, value]) => equal(name, item.fields?.[name], value)); }
const frozen = item => Object.freeze({ ...item, fields: Object.freeze({ ...item.fields }) });

/** Existing future registrations only. No supplier scans, schema/ACL reads, creation or import. */
export function createContractorEmploymentStore({ repository, siteKey = 'personal', assertSession } = {}) {
  const pending = new Map(), reviews = new WeakMap(), approved = new WeakMap(), statusReviews = new Set();
  let saving = false;
  function check(signal) {
    assertSession?.();
    if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
  }
  async function guarded(request, signal) { check(signal); const value = await request(); check(signal); return value; }
  async function describe(name, signal) {
    const list = await guarded(() => repository.resolveList(siteKey, [name], { signal }), signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error('A lista ' + name + ' não está disponível para esta sessão.');
    return list;
  }
  async function get(list, itemId, signal, query = '$expand=fields') {
    const item = await guarded(() => repository.getItem(siteKey, list.id, itemId, query, { signal }), signal);
    if (String(item?.id) !== itemId || !item.fields || !etag(item) || etag(item) === '*') throw new Error('O registro e seu ETag não foram confirmados; atualize a galeria.');
    return item;
  }
  function sourceQuery(fields = []) {
    const names = [...new Set(['STATUS', 'EMPREITEIRO', ...fields])];
    if (names.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('Campo do fornecedor inválido para confirmação.');
    return '$select=id,eTag&$expand=fields($select=' + names.join(',') + ')';
  }
  async function loadSnapshot({ signal } = {}) {
    const list = await describe('FUNCIONARIOSRH', signal);
    const columns = await guarded(() => repository.getColumns(siteKey, list.id, { signal }), signal);
    const rows = [], cursors = new Set(), ids = new Set();
    let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      const page = await guarded(() => repository.getItemsPage(siteKey, list.id, '$expand=fields&$top=100', {
        pageNumber, maxPages: 100, ...(cursor ? { cursor } : {}), signal,
      }), signal);
      if (!Array.isArray(page?.items)) throw new Error('Não foi possível carregar a galeria completa.');
      for (const item of page.items) {
        const itemId = id(item.id);
        if (ids.has(itemId)) throw new Error('A paginação retornou um funcionário duplicado; atualize a galeria.');
        ids.add(itemId); rows.push(item);
      }
      if (!page.hasMore) return { rows, columns };
      if (!page.nextLink || cursors.has(page.nextLink)) throw new Error('A paginação da galeria não pôde ser concluída.');
      cursor = page.nextLink; cursors.add(cursor);
    }
    throw new Error('A paginação da galeria excedeu o limite; a busca não está completa.');
  }
  async function findByOrigin(originId, { signal } = {}) {
    const origin = id(originId), list = await describe('FUNCIONARIOSRH', signal);
    const page = await guarded(() => repository.getItemsPage(siteKey, list.id,
      "$expand=fields&$filter=fields/IDFORNECEDORORIGEM eq '" + origin + "'&$top=2", { signal }), signal);
    if (!Array.isArray(page?.items) || page.hasMore || page.items.length > 1) throw new Error('O vínculo RH não foi confirmado de forma única; nenhuma alteração foi gravada.');
    if (!page.items.length) return null;
    const item = page.items[0];
    if (id(item.fields?.IDFORNECEDORORIGEM) !== origin) throw conflict('O vínculo RH retornado não corresponde ao fornecedor escolhido.');
    const confirmed = await get(list, id(item.id), signal);
    if (id(confirmed.fields.IDFORNECEDORORIGEM) !== origin) throw conflict('O vínculo RH mudou durante a consulta; confira o fornecedor novamente.');
    return confirmed;
  }
  async function pair(origin, targetId, signal, includeSource) {
    const targetList = await describe('FUNCIONARIOSRH', signal), target = await get(targetList, targetId, signal);
    if (id(target.fields.IDFORNECEDORORIGEM) !== origin) throw conflict('O vínculo de origem mudou; confira novamente os registros.');
    if (!includeSource) return { target, source: null };
    const sourceList = await describe('FORNECEDORES', signal), source = await get(sourceList, origin, signal, sourceQuery());
    return { source, target };
  }
  function canRenew(checkpoint, records) {
    // A confirmed source write cannot clear an unknown target PATCH. Each uncertain
    // If-Match must be superseded, or the same original intent must be verified.
    return !checkpoint || [...checkpoint.uncertain].every(([kind, version]) => etag(records[kind]) !== version);
  }
  async function loadConflict(selected, { signal } = {}) {
    check(signal);
    if (saving) throw new Error('Aguarde a atualização em andamento antes de conferir o conflito.');
    const origin = id(selected?.fields?.IDFORNECEDORORIGEM), targetId = id(selected?.id), checkpoint = pending.get(origin);
    const includeSource = Boolean(checkpoint?.sourceFields || statusReviews.has(origin));
    const records = await pair(origin, targetId, signal, includeSource);
    if (pending.get(origin) !== checkpoint) throw conflict('A operação mudou durante a consulta; confira os registros novamente.');
    const review = Object.freeze({ source: records.source ? frozen(records.source) : null, target: frozen(records.target), canRenew: canRenew(checkpoint, records) });
    reviews.set(review, { origin, targetId, checkpoint, includeSource, ...records }); return review;
  }
  async function renewBaseline(review, { signal } = {}) {
    check(signal);
    const previous = reviews.get(review);
    if (!previous) throw conflict('Confira os dados atuais de RH e o status do fornecedor antes de iniciar outra edição.');
    if (saving) throw new Error('Uma atualização de funcionário já está em andamento.');
    saving = true;
    try {
      const { origin, targetId, checkpoint } = previous, records = await pair(origin, targetId, signal, previous.includeSource);
      if (pending.get(origin) !== checkpoint || etag(records.source) !== etag(previous.source) || etag(records.target) !== etag(previous.target)) {
        throw conflict('RH ou fornecedor foram alterados após a conferência; confira os dados novamente.');
      }
      if (!canRenew(checkpoint, records)) throw new Error('A gravação anterior permanece incerta. Confirme a tentativa original antes de iniciar outra edição.');
      // Only STATUS is shared. Cargo, dates and all other data remain RH-owned.
      const baseline = { ...records.target, fields: { ...records.target.fields, ...(records.source ? { STATUS: records.source.fields.STATUS } : {}) } };
      approved.set(baseline, records); pending.delete(origin); reviews.delete(review); return baseline;
    } finally { saving = false; }
  }
  async function save(selected, draft, { signal, sourceEdit } = {}) {
    check(signal);
    const desired = validateContractorEmploymentDraft(draft), targetId = id(selected?.id), origin = id(selected?.fields?.IDFORNECEDORORIGEM);
    if (sourceEdit && String(sourceEdit.selected?.id) !== origin) throw conflict('O fornecedor exibido não corresponde ao vínculo de origem RH.');
    if (!etag(selected) || etag(selected) === '*') throw new Error('O ETag do funcionário não está disponível; atualize a galeria.');
    if (saving) throw new Error('Uma atualização de funcionário já está em andamento.');
    saving = true;
    try {
      const targetList = await describe('FUNCIONARIOSRH', signal), target = await get(targetList, targetId, signal);
      if (id(target.fields.IDFORNECEDORORIGEM) !== origin) throw conflict('O vínculo original do funcionário foi alterado.');
      const previous = pending.get(origin), accepted = approved.get(selected);
      const baseline = accepted?.target || selected;
      const sourceFields = previous?.sourceFields || (sourceEdit || desired.STATUS !== baseline.fields.STATUS
        ? { ...Object.fromEntries(Object.entries(sourceEdit?.fields || {}).filter(([name]) => !['CARGO', ...rhDates].includes(name))), STATUS: desired.STATUS }
        : null);
      if (sourceFields) statusReviews.add(origin);
      const fingerprint = JSON.stringify({ desired, sourceFields });
      if (previous && (previous.targetId !== targetId || previous.fingerprint !== fingerprint)) throw conflict('Confirme a atualização pendente com os mesmos dados ou confira as versões antes de iniciar outra edição.');
      if (!previous && etag(target) !== etag(baseline)) throw conflict('O funcionário foi alterado; atualize a galeria antes de editar.');
      if (previous && etag(target) !== previous.targetETag && !matches(target, desired)) throw conflict('O funcionário foi alterado durante a atualização pendente; confira a galeria.');
      let sourceList, source;
      if (sourceFields) {
        sourceList = sourceEdit?.list || await describe('FORNECEDORES', signal);
        source = await get(sourceList, origin, signal, sourceQuery(Object.keys(sourceFields)));
        if (!previous) {
          const expected = accepted?.source || sourceEdit?.selected;
          if (expected && etag(source) !== etag(expected)) throw conflict('O fornecedor foi alterado após a conferência; confira os dados novamente.');
          if (key(source.fields.STATUS) !== key((expected || baseline).fields.STATUS)) throw conflict('O status do fornecedor diverge do funcionário exibido; confira os registros antes de editar.');
        } else if (etag(source) !== previous.sourceETag && !matches(source, sourceFields)) {
          throw conflict('O status da fonte foi alterado ou sua gravação não foi confirmada; confira os registros.');
        }
      }
      const checkpoint = previous || { fingerprint, targetId, targetETag: etag(target), sourceETag: etag(source),
        sourceFields, uncertain: new Map(), completed: false };
      const patch = Object.fromEntries(Object.entries(desired).filter(([name, value]) => !equal(name, target.fields[name], value)));
      async function write(kind, list, item, fields) {
        pending.set(origin, checkpoint); checkpoint.uncertain.set(kind, etag(item));
        try { await guarded(() => repository.updateItem(siteKey, list.id, item.id, fields, { eTag: etag(item), signal }), signal); }
        catch (cause) {
          if (cause?.status === 412) {
            checkpoint.uncertain.delete(kind);
            if (!checkpoint.completed && !checkpoint.uncertain.size) pending.delete(origin);
          }
          throw cause;
        }
        const confirmed = await get(list, item.id, signal, kind === 'source' ? sourceQuery(Object.keys(fields)) : '$expand=fields');
        if (!matches(confirmed, fields)) throw new Error('A gravação ' + (kind === 'source' ? 'do status da fonte' : 'no RH') + ' não foi confirmada.');
        checkpoint.uncertain.delete(kind); checkpoint.completed = true; return confirmed;
      }
      if (sourceFields) {
        if (!matches(source, sourceFields)) source = await write('source', sourceList, source, sourceFields);
        else {
          if (checkpoint.uncertain.has('source') && etag(source) !== checkpoint.uncertain.get('source')) checkpoint.completed = true;
          checkpoint.uncertain.delete('source');
        }
      }
      if (Object.keys(patch).length) await write('target', targetList, target, patch);
      const confirmed = await get(targetList, targetId, signal);
      if (id(confirmed.fields.IDFORNECEDORORIGEM) !== origin || !matches(confirmed, desired)) throw new Error('O RH não confirmou os dados gravados.');
      const confirmedSource = sourceFields ? await get(sourceList, origin, signal, sourceQuery(Object.keys(sourceFields))) : null;
      if (sourceFields && !matches(confirmedSource, sourceFields)) throw new Error('Os dados solicitados da fonte mudaram durante a atualização.');
      pending.delete(origin); statusReviews.delete(origin); return sourceEdit ? confirmedSource : confirmed;
    } catch (cause) {
      if (pending.has(origin)) throw Object.assign(new Error('A atualização não foi confirmada. RH ou status do fornecedor podem ter sido gravados. Confira os registros e tente novamente com os mesmos dados; o ID de origem será mantido.'), { code: 'CONTRACTOR_EMPLOYMENT_PARTIAL', cause, originId: origin });
      throw cause;
    } finally { saving = false; }
  }
  return Object.freeze({ loadSnapshot, findByOrigin, save, loadConflict, renewBaseline });
}
