import { createContractorEmploymentStore } from './contractor-employment-store.js';
import { requestContractorTerminationDate, validateContractorTermination } from './contractor-employment.js';

const rhFields = ['CARGO', 'DATAADMISSAO', 'DATADESLIGAMENTO'];
function service(repository, entity, options) {
  return createContractorEmploymentStore({ repository, siteKey: entity.siteKey || 'personal', ...options });
}
function recovery(data, target, selected) {
  return Object.freeze({
    loadConflict: () => data.loadConflict(target, { sourceEdit: true }),
    async renewBaseline(review) {
      const baseline = await data.renewBaseline(review), operation = data.getPending(baseline);
      return {
        item: { ...selected, ...review.source, fields: { ...selected.fields, ...review.source?.fields } },
        fields: { ...operation?.pendingSourceFields, DATADESLIGAMENTO: operation?.draft.DATADESLIGAMENTO },
      };
    },
  });
}
/** Reads the durable local journal first. No source scan, import or mutation on page recreation. */
export async function loadTrackedContractorSupplierRecovery(repository, entity, selected, options = {}) {
  if (entity?.id !== 'fornecedores') return null;
  const data = service(repository, entity, options), operation = data.getPendingOrigin(selected.id);
  if (!operation) return null;
  const target = await data.findByOrigin(selected.id);
  if (!target || target.id !== operation.targetId) throw new Error('O vínculo da atualização pendente não foi confirmado.');
  return recovery(data, target, selected);
}

/** Existing links only; unrelated supplier forms keep their normal persistence path. */
export async function persistTrackedContractorSupplierEdit(repository, entity, list, fields, options = {}) {
  if (entity?.id !== 'fornecedores' || options.mode !== 'edit' || !Object.hasOwn(fields, 'STATUS')) return null;
  const selected = options.item, status = String(fields.STATUS || '').trim().toUpperCase();
  if (!['ATIVO', 'INATIVO'].includes(status)) return null;
  const data = service(repository, entity, options);
  if (status === String(selected?.fields?.STATUS || '').trim().toUpperCase()) {
    try { if (!data.getPendingOrigin(selected.id)) return null; }
    catch (error) { if (error.code === 'CONTRACTOR_EMPLOYMENT_JOURNAL_UNAVAILABLE') return null; throw error; }
  }
  const target = await data.findByOrigin(String(selected?.id || ''), { signal: options.signal });
  if (!target) return null;
  const previous = data.getPending(target);
  const changes = Object.fromEntries(Object.entries(fields).filter(([name, value]) => !rhFields.includes(name)
    && (name === 'STATUS' || JSON.stringify(value) !== JSON.stringify(selected.fields?.[name]))));
  if (previous) {
    if (Object.entries(changes).some(([name, value]) => JSON.stringify(value) !== JSON.stringify(previous.sourceFields?.[name]))
      || (options.fields?.DATADESLIGAMENTO !== undefined && options.fields.DATADESLIGAMENTO !== previous.draft.DATADESLIGAMENTO)) {
      throw Object.assign(new Error('A edição anterior permanece pendente. Confira as versões atuais antes de mudar os dados.'), {
        code: 'CONTRACTOR_EMPLOYMENT_PARTIAL', contractorRecovery: recovery(data, target, selected),
      });
    }
  }
  let draft = previous?.draft;
  if (!draft) {
    let termination = null;
    if (status === 'INATIVO') {
      const supplied = options.fields?.DATADESLIGAMENTO;
      termination = supplied !== undefined ? supplied : target.fields.DATADESLIGAMENTO || await requestContractorTerminationDate({
        document: options.document ?? globalThis.document, admission: target.fields.DATAADMISSAO,
      });
      termination = validateContractorTermination({ DATAADMISSAO: target.fields.DATAADMISSAO, DATADESLIGAMENTO: termination });
    }
    draft = { ...target.fields, STATUS: status, DATADESLIGAMENTO: termination };
  }
  try {
    return await data.save(target, draft, { signal: options.signal, sourceEdit: { list, selected, fields: previous?.sourceFields || changes } });
  } catch (error) {
    if (error.status === 412 || ['CONTRACTOR_EMPLOYMENT_PARTIAL', 'CONTRACTOR_EMPLOYMENT_DIVERGED'].includes(error.code)) error.contractorRecovery = recovery(data, target, selected);
    throw error;
  }
}
