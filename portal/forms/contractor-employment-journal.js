import { validateContractorEmploymentDraft } from './contractor-employment.js';
const unavailable = cause => Object.assign(new Error('O diário de atualização RH exige conta, site e armazenamento persistente disponíveis. Preserve a pendência e confira os registros antes de continuar.'), { code: 'CONTRACTOR_EMPLOYMENT_JOURNAL_UNAVAILABLE', cause });
const rhFields = ['CARGO', 'DATAADMISSAO', 'STATUS', 'DATADESLIGAMENTO'];
function validRecord(record, origin) {
  if (record.version !== 1 || record.origin !== origin || !/^[1-9]\d*$/.test(record.targetId)
    || !Number.isSafeInteger(Number(record.targetId)) || !Array.isArray(record.uncertain) || record.uncertain.length > 2
    || !record.targetFields || Array.isArray(record.targetFields)
    || Object.keys(record.targetFields).some(name => !rhFields.includes(name))
    || record.uncertain.some(entry => !Array.isArray(entry) || entry.length !== 2 || !['source', 'target'].includes(entry[0]) || typeof entry[1] !== 'string' || !entry[1] || entry[1] === '*')) return false;
  if (JSON.stringify(validateContractorEmploymentDraft(record.desired)) !== JSON.stringify(record.desired)) return false;
  if (record.sourceFields !== null && (typeof record.sourceFields !== 'object' || Array.isArray(record.sourceFields)
    || record.sourceFields.STATUS !== record.desired.STATUS
    || Object.keys(record.sourceFields).some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ['CARGO', 'DATAADMISSAO', 'DATADESLIGAMENTO', '__proto__', 'constructor', 'prototype'].includes(name)))) return false;
  return record.fingerprint === JSON.stringify({ desired: record.desired, sourceFields: record.sourceFields });
}

/** Only IDs, intended changed fields and ETag/checkpoints; never tokens, attachments or source snapshots. */
export function createContractorEmploymentJournal({ accountKey, siteIdentity, siteKey, storage } = {}) {
  const scope = accountKey && siteIdentity ? JSON.stringify([siteIdentity, siteKey, accountKey]) : '';
  const prefix = 'energetico.contractor-employment.v1:' + encodeURIComponent(scope) + ':';
  const cache = new Map();
  function backend() {
    if (!scope) throw unavailable();
    try {
      const result = storage === undefined ? globalThis.localStorage : storage;
      if (!result?.getItem || !result?.setItem || !result?.removeItem) throw unavailable();
      return result;
    } catch (cause) { throw unavailable(cause); }
  }
  function get(origin) {
    const name = prefix + origin;
    let raw;
    try { raw = backend().getItem(name); } catch (cause) { throw unavailable(cause); }
    const saved = cache.get(origin);
    if (saved?.raw === raw) return saved.value;
    if (raw === null) { cache.set(origin, { raw, value: undefined }); return undefined; }
    try {
      const record = JSON.parse(raw);
      if (!validRecord(record, origin)) throw new Error('invalid journal');
      const value = { ...record, uncertain: new Map(record.uncertain) };
      cache.set(origin, { raw, value }); return value;
    } catch (cause) { throw unavailable(cause); }
  }
  function write(origin, value) {
    const name = prefix + origin, store = backend(), expected = cache.get(origin)?.raw ?? null;
    try {
      if (store.getItem(name) !== expected) throw new Error('O diário foi alterado em outra janela; confira a operação pendente.');
      const raw = value ? JSON.stringify({ ...value, version: 1, origin, uncertain: [...value.uncertain] }) : null;
      if (value) store.setItem(name, raw); else store.removeItem(name);
      if (store.getItem(name) !== raw) throw new Error('O diário não confirmou a persistência.');
      cache.set(origin, { raw, value });
    } catch (cause) { throw unavailable(cause); }
  }
  return Object.freeze({ get, set: write, delete: origin => write(origin, undefined), has: origin => Boolean(get(origin)) });
}
