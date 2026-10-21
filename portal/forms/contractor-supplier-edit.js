import { createContractorEmploymentStore } from './contractor-employment-store.js';
import { requestContractorTerminationDate, validateContractorTermination } from './contractor-employment.js';

// Keep the original intent across a partial supplier-form save, not across unrelated repositories/sessions.
const contexts = new WeakMap();
function context(repository, siteKey) {
  let sites = contexts.get(repository);
  if (!sites) { sites = new Map(); contexts.set(repository, sites); }
  if (!sites.has(siteKey)) sites.set(siteKey, { data: createContractorEmploymentStore({ repository, siteKey }), pending: new Map() });
  return sites.get(siteKey);
}

/** Returns null for legacy/unrelated edits. Never creates or imports an RH row. */
export async function persistTrackedContractorSupplierEdit(repository, entity, list, fields, options = {}) {
  if (entity?.id !== 'fornecedores' || options.mode !== 'edit' || !Object.hasOwn(fields, 'STATUS')) return null;
  const selected = options.item, status = String(fields.STATUS || '').trim().toUpperCase();
  // A supplier's editable classification cannot remove an existing RH lifecycle link.
  if (!['ATIVO', 'INATIVO'].includes(status)) return null;
  const siteKey = entity.siteKey || 'personal', origin = String(selected?.id || ''), state = context(repository, siteKey);
  const sourceFields = Object.fromEntries(Object.entries(fields).filter(([name]) => !['CARGO', 'DATAADMISSAO', 'DATADESLIGAMENTO'].includes(name)));
  const suppliedDate = options.fields?.DATADESLIGAMENTO;
  const fingerprint = JSON.stringify({ fields: sourceFields, date: suppliedDate ?? null });
  let operation = state.pending.get(origin);
  if (operation && operation.fingerprint !== fingerprint) throw new Error('A edição anterior permanece pendente. Confirme os mesmos dados antes de iniciar outra edição.');
  if (!operation) {
    const target = await state.data.findByOrigin(origin, { signal: options.signal });
    if (!target) return null;
    let termination = null;
    if (status === 'INATIVO') {
      termination = suppliedDate || target.fields.DATADESLIGAMENTO || await requestContractorTerminationDate({
        document: options.document ?? globalThis.document, admission: target.fields.DATAADMISSAO,
      });
      termination = validateContractorTermination({ DATAADMISSAO: target.fields.DATAADMISSAO, DATADESLIGAMENTO: termination });
    }
    operation = { fingerprint, target, selected, fields: sourceFields,
      draft: { ...target.fields, STATUS: status, DATADESLIGAMENTO: termination } };
  }
  try {
    const saved = await state.data.save(operation.target, operation.draft, { signal: options.signal,
      sourceEdit: { list, selected: operation.selected, fields: operation.fields } });
    state.pending.delete(origin); return saved;
  } catch (error) {
    if (error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL') state.pending.set(origin, operation);
    throw error;
  }
}
