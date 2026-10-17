import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createSupplierPayrollData } from './supplier-payroll-data.js';
import { payrollKey } from './supplier-payroll.js';
import { validatePayrollBreakdown, payrollBreakdownSupplierMatches } from './payroll-breakdown.js';

const SITE = 'personal';
const CHILD_NAMES = ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'];
const id = value => /^[1-9]\d*$/.test(String(value || ''));
const blank = value => value == null || value === '';
const scalar = value => String(value?.LookupValue ?? value?.Value ?? value?.value ?? value ?? '');

export function createPayrollBreakdownData({ repository, tokenProvider, siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch, assertSession = () => {} } = {}) {
  if (!repository) {
    if (typeof tokenProvider !== 'function') throw new TypeError('É necessária uma sessão Microsoft ativa.');
    repository = createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);
  }
  // Every read and mutation is scoped to the same active account, including after awaits.
  const scoped = Object.fromEntries(['resolveList', 'getColumns', 'getItems', 'getItemsPage', 'getItem', 'createItem'].map(method => [method, async (...args) => {
    assertSession(); const value = await repository[method](...args); assertSession(); return value;
  }]));
  const suppliers = createSupplierPayrollData({ repository: scoped, tokenProvider, siteConfig, assertSession });
  let posting = false;
  async function describe(names) {
    const list = await scoped.resolveList(SITE, names);
    if (!list?.id || list.status && list.status !== 'resolved') throw new Error(`A lista ${names[0]} não foi localizada.`);
    const columns = await scoped.getColumns(SITE, list.id);
    if (!Array.isArray(columns)) throw new Error('Não foi possível ler os campos das provisões.');
    return { id: list.id, columns, name: names[0] };
  }
  function column(descriptor, label, optional = false) {
    const writable = descriptor.columns.filter(c => !c.readOnly && !c.computed && !c.hidden);
    const exact = writable.filter(c => payrollKey(c.name) === payrollKey(label));
    const found = exact.length ? exact : writable.filter(c => payrollKey(c.displayName) === payrollKey(label));
    if (!found.length && optional) return null;
    if (found.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(found[0].name)) throw new Error(`O campo ${label} de ${descriptor.name} não foi identificado de forma única.`);
    return found[0];
  }
  function payload(descriptor, fields, optional = []) {
    const output = {}, assigned = new Set();
    for (const [label, value] of Object.entries(fields)) {
      const c = column(descriptor, label, optional.includes(label)); if (!c) continue;
      if (assigned.has(c.name)) throw new Error(`Os campos de ${descriptor.name} estão conflitantes.`); assigned.add(c.name);
      if (value === null) { output[c.name] = c.dateTime ? null : ''; continue; }
      if (c.dateTime) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error(`Data inválida em ${label}.`); output[c.name] = `${value}T00:00:00Z`; }
      else if (c.text) output[c.name] = String(value);
      else if (c.number || c.currency) {
        const number = Number(value); if (!Number.isFinite(number)) throw new Error(`Número inválido em ${label}.`); output[c.name] = number;
      } else if (c.choice) {
        if (c.choice.choices?.length && value !== '' && !c.choice.choices.includes(String(value))) throw new Error(`A opção ${value} não existe em ${label}.`);
        output[c.name] = String(value);
      } else throw new Error(`O tipo do campo ${label} não é compatível com a provisão.`);
    }
    return output;
  }
  async function rows(descriptor) {
    // Complete collection API paginates and refuses incomplete responses.
    const result = await scoped.getItems(SITE, descriptor.id, '$expand=fields');
    if (!Array.isArray(result)) throw new Error('A consulta das provisões está incompleta.');
    return result;
  }
  function verify(descriptor, row, fields) {
    if (!id(row?.id)) throw new Error('O SharePoint não confirmou o registro.');
    for (const [name, expected] of Object.entries(fields)) {
      const actual = row.fields?.[name], date = descriptor.columns.find(c => c.name === name)?.dateTime;
      if (!(blank(actual) && blank(expected) || typeof expected === 'number' && actual != null && Number(actual) === expected
        || scalar(actual) === String(expected) || date && !blank(actual) && !blank(expected) && Date.parse(actual) === Date.parse(expected)))
        throw new Error(`O registro ID ${row.id} mudou no campo ${name}. Confira-o antes de retomar.`);
    }
    return String(row.id);
  }
  async function ensure(descriptor, fields, state, changed) {
    const title = column(descriptor, 'Title').name;
    if (state.id) {
      const row = await scoped.getItem(SITE, descriptor.id, state.id, '$expand=fields');
      if (String(row?.id) !== String(state.id)) throw new Error('A identidade da provisão mudou.');
      return verify(descriptor, row, fields);
    }
    const find = async () => {
      const matches = (await rows(descriptor)).filter(row => scalar(row.fields?.[title]) === fields[title]);
      if (matches.length > 1) throw new Error('Há registros duplicados desta operação. Confira as provisões.');
      return matches[0];
    };
    let found = await find();
    if (!found) {
      if (state.attempted) throw new Error('A resposta do envio anterior ainda está pendente. Retome o mesmo envio para recuperar a provisão.');
      state.attempted = true; changed();
      try { found = await scoped.createItem(SITE, descriptor.id, fields); }
      catch (cause) {
        // Explicit validation/auth/throttling rejections did not commit the POST.
        // Transport failures and server errors remain recovery-only.
        if ([400, 401, 403, 429].includes(cause?.status)) { state.attempted = false; changed(); throw cause; }
        found = await find(); if (!found) throw cause;
      }
      if (!id(found?.id)) found = await find();
      if (!id(found?.id)) throw new Error('O envio ainda não retornou um ID confirmado. Retome o mesmo envio.');
    }
    state.id = String(found.id); changed();
    const saved = await scoped.getItem(SITE, descriptor.id, state.id, '$expand=fields');
    if (String(saved?.id) !== state.id) throw new Error('A identidade do registro não foi confirmada.');
    return verify(descriptor, saved, fields);
  }
  async function post(rawDraft, progress = {}, onProgress = () => {}) {
    if (posting) throw new Error('O desdobramento já está sendo enviado.');
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(progress.operationId || ''))) throw new Error('A operação não foi identificada.');
    posting = true;
    try {
      const draft = validatePayrollBreakdown(rawDraft), signature = JSON.stringify(draft);
      if (progress.signature && progress.signature !== signature) throw new Error('O desdobramento não pode ser alterado depois do início do envio.');
      const live = (await suppliers.loadSuppliers()).find(row => row.id === draft.supplier.id);
      if (!live || !payrollBreakdownSupplierMatches(live, draft.supplier)) throw new Error('O fornecedor, sua filial ou profissão mudou. Confira o cadastro antes de submeter.');
      const [parent, child] = await Promise.all([describe(['DESCRITIVOPROVISAO']), describe(CHILD_NAMES)]);
      if (parent.id === child.id) throw new Error('As listas da provisão e do descritivo devem ser distintas.');
      const pairs = draft.lines.map(line => {
        const token = `folha-${progress.operationId}-${line.date}-${line.rubric}`;
        const common = { FILIAL: live.branch, FORNECEDOR: live.label, FORMAPGTO: '', OBS: line.observation,
          DATAPREVISTOPGTO: line.date, DATAPGTOEFETUADO: null, DATAPGTOAGENDADO: null, DATAEXECUCAOAGENDAMENTO: null };
        const parentFields = payload(parent, { Title: `descritivo:${token}`, ...common, VALORTOTAL: line.total, PGTOAGENDADO: null });
        const childFields = payload(child, { Title: `provisao:${token}`, ...common, PRODUTO: live.profession, QTD: line.quantity,
          VALORTOTAL: line.unitValue, FRETE: 0, ETAPA: '', STATUS: 'PAGAMENTO PREVISTO', PGTOAGENDADO: 'PENDENTE', TIPOPGTO: line.payrollType, DESCRITIVOPROVISAO: '1' }, ['ETAPA', 'TIPOPGTO']);
        return { line, parentFields, childFields, key: `${line.date}:${line.rubric}` };
      });
      // All field mappings and amounts are validated before the first financial write.
      progress.signature = signature; progress.lines ??= {}; onProgress();
      const result = [];
      for (const pair of pairs) {
        assertSession();
        const state = progress.lines[pair.key] ??= { parent: {}, child: {} };
        const parentId = await ensure(parent, pair.parentFields, state.parent, onProgress);
        const link = column(child, 'DESCRITIVOPROVISAO');
        const fields = { ...pair.childFields, [link.name]: link.text ? parentId : Number(parentId) };
        const childId = await ensure(child, fields, state.child, onProgress);
        result.push({ ...pair.line, parentId, id: childId });
      }
      return { lines: result, total: draft.total, rubrics: draft.rubrics };
    } finally { posting = false; }
  }
  return Object.freeze({ prepare: suppliers.prepare, loadSuppliers: suppliers.loadSuppliers, post });
}
