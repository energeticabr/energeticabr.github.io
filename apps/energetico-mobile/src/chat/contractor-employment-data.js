import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { contractorEmploymentDate, validateContractorEmploymentDraft } from '../../../../portal/forms/contractor-employment.js';

const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const key = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase('pt-BR');
const etag = item => String(item?.eTag || item?.['@odata.etag'] || '').trim();
const EMPLOYMENT_FIELDS = ['CARGO', 'DATAADMISSAO', 'DATADESLIGAMENTO', 'STATUS'];
function employmentBaseline(item) {
  return Object.fromEntries(EMPLOYMENT_FIELDS.map(name => {
    const raw = text(item?.fields?.[name]);
    return [name, name.startsWith('DATA') ? contractorEmploymentDate(raw) || raw : raw];
  }));
}
function sameEmployment(left, right) {
  const a = employmentBaseline(left), b = employmentBaseline(right);
  return EMPLOYMENT_FIELDS.every(name => a[name] === b[name]);
}
const divergence = message => Object.assign(new Error(message), { code: 'CONTRACTOR_EMPLOYMENT_DIVERGED' });
function id(value) {
  const result = String(value ?? '');
  if (!/^[1-9]\d*$/.test(result) || !Number.isSafeInteger(Number(result))) throw new Error('ID de funcionário ou fornecedor inválido.');
  return result;
}
export function filterContractorEmploymentRows(rows, filters = {}) {
  return rows.filter(row => ['STATUS', 'FILIAL', 'CARGO'].every(name => !filters[name] || key(row.fields?.[name]) === key(filters[name]))
    && (!filters.search || key([row.id, ...Object.values(row.fields || {})].map(text).join(' ')).includes(key(filters.search))));
}
function matches(item, fields) {
  return Object.entries(fields).every(([name, value]) => name.startsWith('DATA')
    ? contractorEmploymentDate(item.fields?.[name]) === (value || '')
    : item.fields?.[name] === value);
}

/** Only updates existing linked records. Source creation and mirror reconciliation belong to the server. */
export function createContractorEmploymentData(options = {}) {
  const siteKey = options.siteKey || 'personal';
  const repository = options.repository || createSharePointRepository(
    createGraphClient(options.tokenProvider, { fetch: options.fetchImpl || globalThis.fetch }), options.siteConfig || SHAREPOINT_SITES);
  const pending = new Map();
  const reviews = new WeakMap(), approvedBaselines = new WeakMap();
  let saving = false;
  function check(signal) {
    options.assertSession?.();
    if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
  }
  async function guarded(request, signal) { check(signal); const result = await request(); check(signal); return result; }
  async function describe(name, signal) {
    const list = await guarded(() => repository.resolveList(siteKey, [name], { signal }), signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error('A lista ' + name + ' não está disponível para esta sessão.');
    return list;
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
  async function get(list, itemId, signal) {
    const item = await guarded(() => repository.getItem(siteKey, list.id, itemId, '$expand=fields', { signal }), signal);
    if (String(item?.id) !== itemId || !item.fields || !etag(item) || etag(item) === '*') throw new Error('O registro e seu ETag não foram confirmados; atualize a galeria.');
    return item;
  }
  async function conflictPair(origin, targetId, signal) {
    const [sourceList, targetList] = await Promise.all(['FORNECEDORES', 'FUNCIONARIOSRH'].map(name => describe(name, signal)));
    const source = await get(sourceList, origin, signal), target = await get(targetList, targetId, signal);
    if (id(target.fields.IDFORNECEDORORIGEM) !== origin) throw divergence('O vínculo de origem mudou; confira novamente os registros.');
    if (key(source.fields.EMPREITEIRO) !== 'SIM') throw divergence('O fornecedor de origem não está marcado como empreiteiro.');
    return { source, target };
  }
  async function loadConflict(selected, { signal } = {}) {
    check(signal);
    if (saving) throw new Error('Aguarde a atualização em andamento antes de conferir o conflito.');
    const origin = id(selected?.fields?.IDFORNECEDORORIGEM), targetId = id(selected?.id), checkpoint = pending.get(origin);
    const { source, target } = await conflictPair(origin, targetId, signal);
    if (pending.get(origin) !== checkpoint) throw divergence('A operação mudou durante a consulta; confira fonte e espelho novamente.');
    const review = Object.freeze({
      source: Object.freeze({ ...source, fields: Object.freeze({ ...source.fields }) }),
      target: Object.freeze({ ...target, fields: Object.freeze({ ...target.fields }) }),
      canRenew: !checkpoint || etag(source) !== checkpoint.sourceETag,
    });
    reviews.set(review, { origin, targetId, checkpoint, source, target });
    return review;
  }
  async function renewBaseline(review, { signal } = {}) {
    check(signal);
    const reviewed = reviews.get(review);
    if (!reviewed) throw divergence('Confira os dados atuais da fonte e do espelho antes de iniciar outra edição.');
    if (saving) throw new Error('Uma atualização de funcionário já está em andamento.');
    saving = true;
    try {
      const { origin, targetId, checkpoint } = reviewed;
      const { source, target } = await conflictPair(origin, targetId, signal);
      if (pending.get(origin) !== checkpoint || etag(source) !== etag(reviewed.source) || etag(target) !== etag(reviewed.target)
        || !sameEmployment(source, reviewed.source) || !sameEmployment(target, reviewed.target)) {
        throw divergence('Fonte ou espelho foram alterados após a conferência; confira os dados novamente.');
      }
      // A new source version makes a delayed PATCH using the old If-Match obsolete.
      // An unchanged version cannot prove that the uncertain original write is settled.
      if (checkpoint && etag(source) === checkpoint.sourceETag) {
        throw new Error('A gravação anterior permanece incerta. Confirme a tentativa original antes de iniciar outra edição.');
      }
      const baseline = { ...target, fields: { ...target.fields, ...employmentBaseline(source) } };
      approvedBaselines.set(baseline, { sourceETag: etag(source), targetETag: etag(target) });
      pending.delete(origin); reviews.delete(review);
      return baseline;
    } finally { saving = false; }
  }
  async function save(selected, draft, { signal } = {}) {
    check(signal);
    const fields = validateContractorEmploymentDraft(draft);
    const targetId = id(selected?.id), origin = id(selected?.fields?.IDFORNECEDORORIGEM);
    if (!etag(selected) || etag(selected) === '*') throw new Error('O ETag do funcionário não está disponível; atualize a galeria.');
    if (saving) throw new Error('Uma atualização de funcionário já está em andamento.');
    saving = true;
    let sourceAttempted = false;
    try {
      const [sourceList, targetList] = await Promise.all(['FORNECEDORES', 'FUNCIONARIOSRH'].map(name => describe(name, signal)));
      const target = await get(targetList, targetId, signal);
      if (id(target.fields.IDFORNECEDORORIGEM) !== origin) throw new Error('O vínculo original do funcionário foi alterado.');
      const fingerprint = JSON.stringify(fields), previous = pending.get(origin);
      if (previous && (previous.targetId !== targetId || previous.fingerprint !== fingerprint)) {
        throw new Error('Confirme a atualização pendente com os mesmos dados antes de iniciar outra edição.');
      }
      if (!previous && etag(target) !== etag(selected)) throw new Error('O funcionário foi alterado; atualize a galeria antes de editar.');
      const source = await get(sourceList, origin, signal);
      if (key(source.fields.EMPREITEIRO) !== 'SIM') throw new Error('O fornecedor de origem não está marcado como empreiteiro.');
      const approved = approvedBaselines.get(selected);
      if (!previous && approved && (etag(source) !== approved.sourceETag || etag(target) !== approved.targetETag)) {
        throw divergence('Fonte ou espelho foram alterados após a conferência; confira os dados novamente.');
      }
      if (!previous && !sameEmployment(source, selected)) {
        throw divergence('Os dados do fornecedor de origem divergem do funcionário exibido. Confira fonte e espelho antes de editar; nenhuma alteração foi gravada.');
      }
      if (previous) {
        if (!matches(source, fields) && etag(source) !== previous.sourceETag) throw new Error('A fonte foi alterada ou a gravação ainda não foi confirmada. Atualize e confira o fornecedor antes de tentar novamente.');
        if (etag(target) !== previous.targetETag && !matches(target, fields)) throw new Error('O funcionário foi alterado durante a atualização pendente; confira a galeria.');
      }
      if (!previous || !matches(source, fields)) {
        pending.set(origin, { fingerprint, targetId, targetETag: etag(target), sourceETag: etag(source) });
        sourceAttempted = true;
        try {
          await guarded(() => repository.updateItem(siteKey, sourceList.id, origin, fields, { eTag: etag(source), signal }), signal);
        } catch (cause) {
          // An explicit precondition failure confirms no source write happened.
          // Unknown transport/read-back failures must retain the reconciliation checkpoint.
          if (cause?.status === 412) { pending.delete(origin); sourceAttempted = false; }
          throw cause;
        }
        const confirmed = await get(sourceList, origin, signal);
        if (!matches(confirmed, fields)) throw new Error('A fonte não confirmou os dados gravados.');
      }
      sourceAttempted = true;
      if (!matches(target, fields)) {
        await guarded(() => repository.updateItem(siteKey, targetList.id, targetId, fields, { eTag: etag(target), signal }), signal);
      }
      const confirmed = await get(targetList, targetId, signal);
      if (id(confirmed.fields.IDFORNECEDORORIGEM) !== origin || !matches(confirmed, fields)) throw new Error('O espelho não confirmou os dados gravados.');
      const confirmedSource = await get(sourceList, origin, signal);
      if (!matches(confirmedSource, fields)) throw new Error('A fonte foi alterada durante a atualização; a operação não foi confirmada.');
      pending.delete(origin);
      return confirmed;
    } catch (cause) {
      if (sourceAttempted || pending.has(origin)) {
        throw Object.assign(new Error('A atualização do fornecedor foi enviada, mas a cópia RH não foi confirmada. Confira a fonte e tente novamente com os mesmos dados; o ID de origem será mantido.'), {
          code: 'CONTRACTOR_EMPLOYMENT_PARTIAL', cause, originId: origin,
        });
      }
      throw cause;
    } finally { saving = false; }
  }
  return Object.freeze({ loadSnapshot, save, loadConflict, renewBaseline });
}
