import {
  provisionCanonicalTotal, provisionTextTotal, provisionUnitPriceForTotal,
} from '../../../../portal/forms/provision-parent-workflow.js';
import { payrollKey, payrollTotal } from './supplier-payroll.js';
import { WEEKLY_PAYSLIP_RUBRICS, weeklyPayslipLines } from './weekly-payslip-lines.js';

const CHILD = ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'];
const PARENT = ['DESCRITIVOPROVISAO'];
const AMOUNT = { QTD: 'QTD', VALORTOTAL: 'VALORTOTAL', FRETE: 'FRETE' };
const id = value => /^[1-9]\d{0,14}$/.test(String(value ?? '')) ? String(value) : '';
const token = (key, rubric) => `folha-semanal-${key}-${rubric}`;
const invalid = () => new Error('Não foi possível confirmar o vínculo de origem da rubrica com a provisão e o descritivo.');
const conflict = () => new Error('Os valores da provisão ou do descritivo mudaram. Reabra o registro e confira a sincronização.');

function links(fields) {
  const raw = JSON.parse(fields.PROVISOES || '[]');
  if (!Array.isArray(raw)) throw invalid();
  const known = new Set(WEEKLY_PAYSLIP_RUBRICS.map(rubric => rubric.id));
  const ids = new Set(), parents = new Set(), rubrics = new Set();
  return raw.map(row => {
    const link = { id: id(row?.id), parentId: id(row?.parentId), rubric: row?.rubric };
    if (!link.id || !link.parentId || !known.has(link.rubric) || ids.has(link.id)
      || parents.has(link.parentId) || rubrics.has(link.rubric)) throw invalid();
    ids.add(link.id);
    parents.add(link.parentId);
    rubrics.add(link.rubric);
    return link;
  });
}

function version(item) {
  const tag = item?.eTag || item?.['@odata.etag'] || item?.['odata.etag'];
  if (!tag || tag === '*') throw conflict();
  return tag;
}

const canonicalAmount = (name, value) => provisionCanonicalTotal(name === 'FRETE' && !String(value ?? '').trim() ? '0' : value);

function amountFields(fields) {
  return Object.fromEntries(Object.keys(AMOUNT).map(name => [name, canonicalAmount(name, fields[name])]));
}

const total = fields => provisionCanonicalTotal(payrollTotal([{
  quantity: fields.QTD, unitValue: fields.VALORTOTAL, freight: fields.FRETE,
}]));
const dateOrPaid = fields => Boolean(fields.DATAPGTOEFETUADO)
  || ['PAGO', 'PAGAMENTOEFETUADO', 'BAIXADO'].includes(payrollKey(fields.STATUS))
  || ['PAGO', 'PAGAMENTOEFETUADO', 'BAIXADO'].includes(payrollKey(fields.PGTOAGENDADO));

function matches(fields, expected) {
  return Object.entries(expected).every(([name, value]) => canonicalAmount(name, fields[name]) === value);
}

export function createWeeklyPayslipProvisionSync({ repository, siteKey, assertSession }) {
  const check = signal => { assertSession(); signal?.throwIfAborted(); };
  async function list(aliases, signal) {
    check(signal);
    const result = await repository.resolveList(siteKey, aliases, { signal });
    check(signal);
    if (result?.status !== 'resolved' || !result.id) throw invalid();
    return result.id;
  }
  async function read(listId, itemId, signal) {
    check(signal);
    const row = await repository.getItem(siteKey, listId, itemId, '$expand=fields', { signal, includeVersion: true });
    check(signal);
    if (id(row?.id) !== itemId || !row.fields) throw invalid();
    version(row);
    return row;
  }
  async function query(listId, column, value, signal, indexed = true) {
    check(signal);
    const filter = `$expand=fields&$filter=fields/${column} eq '${value}'&$top=2`;
    try {
      const page = await repository.getItemsPage(siteKey, listId, filter, {
        pageNumber: 1, maxPages: 2, signal,
        ...(!indexed ? { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } } : {}),
      });
      check(signal);
      if (!Array.isArray(page?.items) || page.hasMore || page.nextLink || page.partial || page.truncated || page.complete === false
        || page.items.some(row => String(row.fields?.[column]) !== value)) throw invalid();
      return page.items;
    } catch (error) {
      check(signal);
      if (indexed || ![400, 422].includes(Number(error?.status)) || !repository.getItems) throw error;
      // The parent reference is text and can be unindexed in existing sites.
      const items = await repository.getItems(siteKey, listId, '$expand=fields($select=DESCRITIVOPROVISAO)&$top=100', { signal });
      check(signal);
      if (!Array.isArray(items) || items.partial || items.truncated || items.complete === false) throw invalid();
      return items.filter(row => String(row.fields?.[column]) === value);
    }
  }

  async function pair(fields, link, signal) {
    const [childList, parentList] = await Promise.all([list(CHILD, signal), list(PARENT, signal)]);
    if (childList === parentList) throw invalid();
    const [child, parent, members] = await Promise.all([
      read(childList, link.id, signal), read(parentList, link.parentId, signal),
      query(childList, 'DESCRITIVOPROVISAO', link.parentId, signal, false),
    ]);
    const origin = token(fields.CHAVE, link.rubric);
    const rubric = WEEKLY_PAYSLIP_RUBRICS.find(row => row.id === link.rubric);
    if (child.fields.FOLHAOPERACAO !== origin || parent.fields.FOLHAOPERACAO !== origin
      || id(child.fields.DESCRITIVOPROVISAO) !== link.parentId
      || payrollKey(child.fields.TIPOPGTO) !== payrollKey(rubric?.payrollType)
      || members.length !== 1 || id(members[0].id) !== link.id) throw invalid();
    if ([child, parent].some(row => dateOrPaid(row.fields))) {
      throw new Error('A provisão da rubrica está paga ou baixada. Revise o pagamento antes de alterar o valor.');
    }
    return { childList, parentList, child, parent };
  }

  function step(link, pair, desired) {
    return {
      rubric: link.rubric, id: link.id, parentId: link.parentId,
      before: amountFields(pair.child.fields), desired,
      childVersion: version(pair.child), parentVersion: version(pair.parent),
      parentBefore: provisionCanonicalTotal(pair.parent.fields.VALORTOTAL),
      parentDesired: total(desired),
    };
  }

  async function fromPayslip(fields, current, proposed, signal) {
    const changes = [];
    for (const link of links(fields)) {
      const before = current.find(line => line.rubrica === link.rubric);
      const after = proposed.find(line => line.rubrica === link.rubric);
      if (before && !after) throw new Error(`A rubrica ${before.label} tem uma provisão vinculada e não pode ser retirada.`);
      if (!after || before && before.quantity === after.quantity && before.unitValue === after.unitValue) continue;
      const currentPair = await pair(fields, link, signal);
      const live = amountFields(currentPair.child.fields);
      if (before && (live.QTD !== before.quantity || live.VALORTOTAL !== before.unitValue)
        && (live.QTD !== after.quantity || live.VALORTOTAL !== after.unitValue)) throw conflict();
      const desired = amountFields({ QTD: after.quantity, VALORTOTAL: after.unitValue, FRETE: live.FRETE });
      if ((after.freight || '0') !== desired.FRETE) throw conflict();
      changes.push(step(link, currentPair, desired));
    }
    return changes;
  }

  async function fromFinance(kind, item, patch, signal) {
    const origin = String(item.fields?.FOLHAOPERACAO || '');
    const match = origin.match(/^folha-semanal-(\d{4}-\d{2}-\d{2}-[1-9]\d{0,14})-([a-z]+)$/);
    if (!match || !WEEKLY_PAYSLIP_RUBRICS.some(line => line.id === match[2])) return null;
    if (kind === 'child' && ['FOLHAOPERACAO', 'TIPOPGTO', 'IDFOLHA'].some(name =>
      Object.hasOwn(patch, name) && String(patch[name]) !== String(item.fields[name]))) throw invalid();
    if (kind === 'child' && Object.hasOwn(patch, 'DESCRITIVOPROVISAO')
      && id(patch.DESCRITIVOPROVISAO) !== id(item.fields.DESCRITIVOPROVISAO)) {
      throw new Error('A provisão do holerite precisa permanecer no descritivo da sua rubrica.');
    }
    const names = kind === 'child' ? Object.keys(AMOUNT) : ['VALORTOTAL'];
    const amountEdit = names.some(name => Object.hasOwn(patch, name));
    if (!Object.keys(patch).length) return null;
    if (amountEdit && dateOrPaid({ ...item.fields, ...patch }))
      throw new Error('A provisão da rubrica está paga ou baixada. Revise o pagamento antes de alterar o valor.');
    const [,key,rubric] = match;
    const holeriteList = await list(['HOLERITE'], signal);
    const found = await query(holeriteList, 'CHAVE', key, signal);
    if (found.length !== 1 || !id(found[0].id)) throw invalid();
    return { holeriteList, row: found[0], amountEdit, prepare: async fields => {
      const link = links(fields).find(link => link.rubric === rubric);
      if (!link || (kind === 'child' ? link.id : link.parentId) !== id(item.id)) throw invalid();
      const current = await pair(fields, link, signal);
      const source = kind === 'child' ? current.child : current.parent;
      const amount = Object.fromEntries(names.filter(name => Object.hasOwn(patch, name)).map(name => [name, patch[name]]));
      if (version(source) !== version(item) && !Object.keys(amount).every(name =>
        matches(source.fields, { [name]: canonicalAmount(name, amount[name]) }))) throw conflict();
      const fieldsBefore = current.child.fields;
      if (kind === 'parent' && canonicalAmount('VALORTOTAL', amount.VALORTOTAL) !== total(amountFields({
        QTD: '1', VALORTOTAL: amount.VALORTOTAL, FRETE: '0',
      }))) throw new Error('Informe o total do descritivo da folha com até duas casas decimais.');
      const desired = amountFields(kind === 'child' ? { ...fieldsBefore, ...amount } : {
        ...fieldsBefore, VALORTOTAL: provisionUnitPriceForTotal(fieldsBefore, AMOUNT, amount.VALORTOTAL),
      });
      const [line] = weeklyPayslipLines([{ rubrica: rubric, quantity: desired.QTD, unitValue: desired.VALORTOTAL, freight: desired.FRETE }]);
      return { changes: [step(link, current, desired)], line, amount, listId: kind === 'child' ? current.childList : current.parentList };
    } };
  }

  async function update(listId, row, before, desired, expectedTag, ensureActive, signal) {
    if (matches(row.fields, desired)) return row;
    if (version(row) !== expectedTag || !matches(row.fields, before)) throw conflict();
    const patch = Object.fromEntries(Object.entries(desired)
      .filter(([name, value]) => !matches(row.fields, { [name]: value }))
      .map(([name,value]) => [name, provisionTextTotal(value)]));
    let failure;
    await ensureActive();
    check(signal);
    try { await repository.updateItem(siteKey, listId, row.id, patch, { eTag: expectedTag, signal }); }
    catch (error) { failure = error; }
    const saved = await read(listId, id(row.id), signal);
    if (!matches(saved.fields, desired) || dateOrPaid(saved.fields)) throw failure || conflict();
    return saved;
  }

  async function apply(fields, changes, ensureActive, signal) {
    const live = links(fields);
    for (const change of changes) {
      const link = live.find(row => row.rubric === change.rubric);
      if (!link || link.id !== change.id || link.parentId !== change.parentId) throw invalid();
      const current = await pair(fields, link, signal);
      const before = amountFields(change.before), desired = amountFields(change.desired);
      const parentBefore = { VALORTOTAL: provisionCanonicalTotal(change.parentBefore) };
      const parentDesired = { VALORTOTAL: total(desired) };
      if (parentDesired.VALORTOTAL !== change.parentDesired) throw invalid();
      if ((!matches(current.child.fields, before) && !matches(current.child.fields, desired))
        || (!matches(current.parent.fields, parentBefore) && !matches(current.parent.fields, parentDesired))) throw conflict();
      if ((!matches(current.child.fields, desired) && version(current.child) !== change.childVersion)
        || (!matches(current.parent.fields, parentDesired) && version(current.parent) !== change.parentVersion)) throw conflict();
      await ensureActive();
      const child = await update(current.childList, current.child, before, desired, change.childVersion, ensureActive, signal);
      if (child.fields.FOLHAOPERACAO !== current.child.fields.FOLHAOPERACAO || id(child.fields.DESCRITIVOPROVISAO) !== link.parentId) throw invalid();
      await update(current.parentList, current.parent, parentBefore, parentDesired, change.parentVersion, ensureActive, signal);
      const confirmed = await pair(fields, link, signal);
      if (!matches(confirmed.child.fields, desired) || !matches(confirmed.parent.fields, parentDesired)) throw conflict();
    }
  }

  return { fromPayslip, fromFinance, apply };
}
