import { contractorEmploymentDate, validateContractorEmploymentDraft } from './contractor-employment.js';
import { createContractorEmploymentJournal } from './contractor-employment-journal.js';

const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const key = value => text(value).trim().toLocaleUpperCase('pt-BR');
const etag = item => String(item?.eTag || item?.['@odata.etag'] || '').trim();
const rhDates = ['DATAADMISSAO', 'DATADESLIGAMENTO'];
const sourceFlags = ['STATUS', 'EMPREITEIRO'];
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
export function createContractorEmploymentStore(options = {}) {
  const { repository, siteKey = 'personal' } = options;
  const session = repository?.getLifecycleContext?.(siteKey) || {};
  const identity = { accountKey: session.accountKey, siteIdentity: session.siteIdentity };
  const settings = { ...session, ...options, siteKey };
  const assertSession = () => {
    session.assertSession?.(); options.assertSession?.();
    const live = repository?.getLifecycleContext?.(siteKey);
    if (live && (live.accountKey !== identity.accountKey || live.siteIdentity !== identity.siteIdentity)) throw new Error('A conta ou o site da sessão RH mudou; reabra a galeria.');
  };
  const pending = createContractorEmploymentJournal(settings), reviews = new WeakMap(), approved = new WeakMap(), statusReviews = new Set();
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
    const selectedFields = query.match(/fields\(\$select=([A-Za-z0-9_,]+)\)/)?.[1].split(',');
    const item = await guarded(() => repository.getItem(siteKey, list.id, itemId, query, {
      signal, ...(selectedFields ? { restrictedFields: selectedFields } : {}),
    }), signal);
    if (String(item?.id) !== itemId || !item.fields || !etag(item) || etag(item) === '*') throw new Error('O registro e seu ETag não foram confirmados; atualize a galeria.');
    return item;
  }
  function sourceNames(fields = {}, mixedForm = false) {
    const names = [...new Set([...sourceFlags, ...(mixedForm ? Object.keys(fields) : [])])];
    if (names.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ['CARGO', ...rhDates].includes(name))) throw new Error('Seleção de campos do fornecedor inválida.');
    return names;
  }
  const sourceQuery = (names = sourceFlags) => '$select=id,eTag&$expand=fields($select=' + names.join(',') + ')';
  const remainingSourceFields = checkpoint => Object.fromEntries(Object.entries(checkpoint.sourceFields || {}).filter(([name]) =>
    name === 'STATUS' || !(checkpoint.confirmedSourceFields || []).includes(name)));
  const needsMixedForm = checkpoint => Object.keys(remainingSourceFields(checkpoint)).some(name => !sourceFlags.includes(name));
  function reconcileSource(checkpoint, source, names) {
    const confirmed = new Set(checkpoint.confirmedSourceFields || []);
    for (const [name, value] of Object.entries(checkpoint.sourceFields || {})) {
      if (name !== 'STATUS' && names.includes(name) && equal(name, source.fields[name], value)) confirmed.add(name);
    }
    checkpoint.confirmedSourceFields = [...confirmed];
    const remaining = remainingSourceFields(checkpoint);
    if (Object.keys(remaining).every(name => names.includes(name)) && matches(source, remaining)) {
      const uncertainVersion = checkpoint.uncertain.get('source');
      if (uncertainVersion && etag(source) !== uncertainVersion) checkpoint.completed = true;
      checkpoint.uncertain.delete('source');
      checkpoint.sourceConfirmed = true;
    }
  }
  function getPending(selected) {
    check();
    const operation = pending.get(id(selected?.fields?.IDFORNECEDORORIGEM));
    if (!operation) return null;
    if (operation.targetId !== id(selected?.id)) throw conflict('A pendência pertence a outro vínculo RH.');
    return { draft: { ...operation.desired }, sourceFields: operation.sourceFields ? { ...operation.sourceFields } : null,
      pendingSourceFields: remainingSourceFields(operation) };
  }
  function getPendingOrigin(origin) {
    check();
    const operation = pending.get(id(origin));
    return operation ? { targetId: operation.targetId, draft: { ...operation.desired }, sourceFields: operation.sourceFields ? { ...operation.sourceFields } : null,
      pendingSourceFields: remainingSourceFields(operation) } : null;
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
  async function pair(origin, targetId, signal, includeSource, names = sourceFlags) {
    const targetList = await describe('FUNCIONARIOSRH', signal), target = await get(targetList, targetId, signal);
    if (id(target.fields.IDFORNECEDORORIGEM) !== origin) throw conflict('O vínculo de origem mudou; confira novamente os registros.');
    if (!includeSource) return { target, source: null };
    const sourceList = await describe('FORNECEDORES', signal), source = await get(sourceList, origin, signal, sourceQuery(names));
    return { source, target };
  }
  function canRenew(checkpoint, records) {
    // A confirmed source write cannot clear an unknown target PATCH. Each uncertain
    // If-Match must be superseded, or the same original intent must be verified.
    return !checkpoint || [...checkpoint.uncertain].every(([kind, version]) => etag(records[kind]) !== version);
  }
  async function loadConflict(selected, { signal, sourceEdit } = {}) {
    check(signal);
    if (saving) throw new Error('Aguarde a atualização em andamento antes de conferir o conflito.');
    const origin = id(selected?.fields?.IDFORNECEDORORIGEM), targetId = id(selected?.id), checkpoint = pending.get(origin);
    if (checkpoint && checkpoint.targetId !== targetId) throw conflict('A pendência pertence a outro vínculo RH.');
    const includeSource = Boolean(checkpoint?.sourceFields || statusReviews.has(origin));
    const names = sourceNames(checkpoint?.sourceFields, Boolean(sourceEdit));
    const records = await pair(origin, targetId, signal, includeSource, names);
    if (pending.get(origin) !== checkpoint) throw conflict('A operação mudou durante a consulta; confira os registros novamente.');
    if (checkpoint?.sourceFields) { reconcileSource(checkpoint, records.source, names); pending.set(origin, checkpoint); }
    const review = Object.freeze({ source: records.source ? frozen(records.source) : null, target: frozen(records.target),
      canRenew: canRenew(checkpoint, records) && (!needsMixedForm(checkpoint || {}) || Boolean(sourceEdit)),
      pendingSourceFields: checkpoint ? Object.freeze(remainingSourceFields(checkpoint)) : null,
      pendingDraft: checkpoint ? Object.freeze({ ...records.target.fields, ...checkpoint.targetFields }) : null });
    reviews.set(review, { origin, targetId, checkpoint, includeSource, names, mixedForm: Boolean(sourceEdit), ...records }); return review;
  }
  async function renewBaseline(review, { signal } = {}) {
    check(signal);
    const previous = reviews.get(review);
    if (!previous) throw conflict('Confira os dados atuais de RH e o status do fornecedor antes de iniciar outra edição.');
    if (saving) throw new Error('Uma atualização de funcionário já está em andamento.');
    saving = true;
    try {
      const { origin, targetId, checkpoint } = previous, records = await pair(origin, targetId, signal, previous.includeSource, previous.names);
      if (pending.get(origin) !== checkpoint || etag(records.source) !== etag(previous.source) || etag(records.target) !== etag(previous.target)) {
        throw conflict('RH ou fornecedor foram alterados após a conferência; confira os dados novamente.');
      }
      if (!canRenew(checkpoint, records) || (needsMixedForm(checkpoint || {}) && !previous.mixedForm)) throw new Error('A gravação anterior permanece incerta. Confirme a tentativa original no formulário de fornecedores antes de iniciar outra edição.');
      // Only STATUS is shared. Cargo, dates and all other data remain RH-owned.
      const baseline = { ...records.target, fields: { ...records.target.fields, ...(records.source ? { STATUS: records.source.fields.STATUS } : {}) } };
      // Carry the same reviewed intent on fresh ETags. Keep the journal durable until confirmation.
      if (checkpoint) {
        if (checkpoint.sourceFields) reconcileSource(checkpoint, records.source, previous.names);
        checkpoint.desired = validateContractorEmploymentDraft(review.pendingDraft);
        checkpoint.targetETag = etag(records.target); checkpoint.sourceETag = etag(records.source);
        checkpoint.uncertain.clear();
        checkpoint.fingerprint = JSON.stringify({ desired: checkpoint.desired, sourceFields: checkpoint.sourceFields });
        pending.set(origin, checkpoint);
        baseline.pendingDraft = { ...checkpoint.desired };
      }
      approved.set(baseline, records); reviews.delete(review); return baseline;
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
      const sourceFields = previous?.sourceFields ? { ...previous.sourceFields, STATUS: desired.STATUS } : (sourceEdit || desired.STATUS !== baseline.fields.STATUS
        ? { ...Object.fromEntries(Object.entries(sourceEdit?.fields || {}).filter(([name]) => !['CARGO', ...rhDates].includes(name))), STATUS: desired.STATUS }
        : null);
      if (sourceFields) statusReviews.add(origin);
      const fingerprint = JSON.stringify({ desired, sourceFields });
      if (previous && (previous.targetId !== targetId || (previous.fingerprint !== fingerprint && !accepted))) throw conflict('Confirme a atualização pendente com os mesmos dados ou confira as versões antes de iniciar outra edição.');
      if (previous && accepted) {
        previous.desired = desired; previous.sourceFields = sourceFields; previous.fingerprint = fingerprint;
        previous.targetFields = Object.fromEntries(Object.entries(desired).filter(([name, value]) => !equal(name, baseline.fields[name], value)));
      }
      if (!previous && etag(target) !== etag(baseline)) throw conflict('O funcionário foi alterado; atualize a galeria antes de editar.');
      if (previous && etag(target) !== previous.targetETag && !matches(target, desired)) throw conflict('O funcionário foi alterado durante a atualização pendente; confira a galeria.');
      const checkpoint = previous || { fingerprint, targetId, targetETag: etag(target), sourceETag: '', desired,
        targetFields: Object.fromEntries(Object.entries(desired).filter(([name, value]) => !equal(name, baseline.fields[name], value))),
        sourceFields, confirmedSourceFields: [], uncertain: new Map(), completed: false };
      const names = sourceNames(sourceFields, Boolean(sourceEdit));
      let sourceList, source;
      if (sourceFields) {
        if (needsMixedForm(checkpoint) && !sourceEdit) throw conflict('Há campos do fornecedor ainda não confirmados. Retome os mesmos dados no formulário de fornecedores.');
        sourceList = sourceEdit?.list || await describe('FORNECEDORES', signal);
        source = await get(sourceList, origin, signal, sourceQuery(names));
        if (!previous) {
          const expected = accepted?.source || sourceEdit?.selected;
          if (expected && etag(source) !== etag(expected)) throw conflict('O fornecedor foi alterado após a conferência; confira os dados novamente.');
          if (key(source.fields.STATUS) !== key((expected || baseline).fields.STATUS)) throw conflict('O status do fornecedor diverge do funcionário exibido; confira os registros antes de editar.');
          checkpoint.sourceETag = etag(source);
          reconcileSource(checkpoint, source, names);
        } else {
          reconcileSource(checkpoint, source, names);
          pending.set(origin, checkpoint);
          if (etag(source) !== previous.sourceETag && !matches(source, remainingSourceFields(checkpoint))) {
            throw conflict('Os campos solicitados do fornecedor foram alterados ou sua gravação não foi confirmada; confira os registros.');
          }
        }
      }
      const patch = Object.fromEntries(Object.entries(desired).filter(([name, value]) => !equal(name, target.fields[name], value)));
      async function write(kind, list, item, fields) {
        checkpoint.uncertain.set(kind, etag(item)); pending.set(origin, checkpoint);
        try { await guarded(() => repository.updateItem(siteKey, list.id, item.id, fields, {
          eTag: etag(item), signal, ...(kind === 'source' ? { readbackFields: names } : {}),
        }), signal); }
        catch (cause) {
          if (cause?.status === 412) {
            checkpoint.uncertain.delete(kind);
            if (!checkpoint.completed && !checkpoint.uncertain.size) pending.delete(origin);
            else pending.set(origin, checkpoint);
          }
          throw cause;
        }
        const confirmed = await get(list, item.id, signal, kind === 'source' ? sourceQuery(names) : '$expand=fields');
        if (!matches(confirmed, fields)) throw new Error('A gravação ' + (kind === 'source' ? 'dos campos do fornecedor' : 'no RH') + ' não foi confirmada.');
        checkpoint.uncertain.delete(kind); checkpoint.completed = true;
        if (kind === 'source') reconcileSource(checkpoint, confirmed, names);
        pending.set(origin, checkpoint); return confirmed;
      }
      // Persist the complete minimal intent before either list can be mutated.
      if (Object.keys(patch).length || (sourceFields && !matches(source, remainingSourceFields(checkpoint)))) pending.set(origin, checkpoint);
      if (sourceFields) {
        if (!matches(source, remainingSourceFields(checkpoint))) {
          const fields = remainingSourceFields(checkpoint);
          source = await write('source', sourceList, source, fields);
        }
        else {
          if (previous) pending.set(origin, checkpoint);
        }
      }
      if (Object.keys(patch).length) await write('target', targetList, target, patch);
      const confirmed = await get(targetList, targetId, signal);
      if (id(confirmed.fields.IDFORNECEDORORIGEM) !== origin || !matches(confirmed, desired)) throw new Error('O RH não confirmou os dados gravados.');
      const confirmedSource = sourceFields ? await get(sourceList, origin, signal, sourceQuery(names)) : null;
      if (sourceFields && !matches(confirmedSource, remainingSourceFields(checkpoint))) throw new Error('Os dados solicitados da fonte mudaram durante a atualização.');
      if (pending.has(origin)) pending.delete(origin);
      statusReviews.delete(origin);
      return sourceEdit ? { ...confirmedSource, fields: { ...sourceEdit.selected.fields, ...confirmedSource.fields } } : confirmed;
    } catch (cause) {
      if (cause.code === 'CONTRACTOR_EMPLOYMENT_JOURNAL_UNAVAILABLE') throw cause;
      if (pending.has(origin)) throw Object.assign(new Error('A atualização não foi confirmada. RH ou status do fornecedor podem ter sido gravados. Confira os registros e tente novamente com os mesmos dados; o ID de origem será mantido.'), { code: 'CONTRACTOR_EMPLOYMENT_PARTIAL', cause, originId: origin });
      throw cause;
    } finally { saving = false; }
  }
  return Object.freeze({ loadSnapshot, findByOrigin, save, loadConflict, renewBaseline, getPending, getPendingOrigin });
}
