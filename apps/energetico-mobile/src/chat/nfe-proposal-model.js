import DecimalBase from 'decimal.js';
import { normalizeSearchText } from '../../../../portal/core/search-text.js';
import { fiscalSupplierSimilarity } from './dda-provision-link.js';
import { NFE_RECENT_STAGE_USES, preferredNfeStage } from './nfe-proposal-learning.js';

const Decimal = DecimalBase.clone({ precision:40 });
export const nfeProposalKey = value => normalizeSearchText(value).replace(/[^a-z0-9]+/g, ' ').trim();
function taxKey(value) {
  const key = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(key) ? key : '';
}
const select = (items, id) => items.find(item => item.id === id);
const byLabel = (items, label) => {
  const key = nfeProposalKey(label);
  return key && items.find(item => nfeProposalKey(item.label) === key);
};
const stopWords = new Set(['DE','DA','DO','DAS','DOS','PARA','COM','SEM','E','O','A'].map(nfeProposalKey));
const words = text => new Set(nfeProposalKey(text).split(' ').filter(word => word && !stopWords.has(word)));
const productKey = value => nfeProposalKey(value).replace(/(\d)\s+(?=[a-z])/g, '$1');
const selectionId = option => option?.id || '';
const unitAliases = new Map(Object.entries({
  und:'un',unid:'un',unidade:'un',unidades:'un',pc:'un',pca:'un',peca:'un',
  cx:'caixa',sc:'saco',sac:'saco',kg:'kg',quilo:'kg',quilograma:'kg',
  h:'hora',hr:'hora',horas:'hora',mt:'m',metro:'m',metros:'m',
  mt2:'m2',metroquadrado:'m2',mt3:'m3',metrocubico:'m3',lt:'l',litro:'l',
}));
function unitKey(value) {
  const key = nfeProposalKey(String(value ?? '').normalize('NFKC')).replace(/ /g, '');
  return unitAliases.get(key) || key;
}

export function nfeProposalUnitMismatch(fiscalUnit, catalogUnit) {
  return Boolean(fiscalUnit && catalogUnit && unitKey(fiscalUnit) !== unitKey(catalogUnit));
}

function pickBest(items, score, threshold, margin) {
  let best, high = -Infinity, runnerUp = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > high) {
      best = item;
      runnerUp = high;
      high = value;
    } else if (value > runnerUp) runnerUp = value;
  }
  return high >= threshold && high - runnerUp >= margin ? best : undefined;
}

function proposedSupplier(invoice, suppliers) {
  const document = taxKey(invoice.taxId);
  const exact = document && suppliers.filter(supplier => taxKey(supplier.taxId) === document);
  if (exact?.length === 1) return exact[0];
  return pickBest(exact?.length ? exact : suppliers,
    supplier => fiscalSupplierSimilarity(invoice.supplier, supplier.label), 0.5, 0.06);
}

function proposedProduct(line, products) {
  const description = productKey(line.description);
  const sourceWords = words(description);
  const unit = nfeProposalKey(line.unit);
  return pickBest(products, product => {
    const sameUnit = Boolean(unit && unit === product.unitKey);
    if (product.name === description) return 1 + (sameUnit ? 0.12 : 0);
    let common = 0, sharesWord = false;
    for (const word of product.terms) {
      if (!sourceWords.has(word)) continue;
      common++;
      sharesWord ||= /[a-z]{3}/.test(word);
    }
    // A shared measure or model number alone cannot identify a product.
    if (!sharesWord) return 0;
    return 0.65 * common / product.terms.size + 0.35 * common / sourceWords.size + (sameUnit ? 0.06 : 0);
  }, 0.76, 0.08)?.option;
}

export function nfeProposalStages(catalog, branchId) {
  const branch = select(catalog.branches, branchId);
  return branch ? catalog.stages.filter(stage => nfeProposalKey(stage.branch) === nfeProposalKey(branch.label)) : [];
}

const stageUsage = new WeakMap();
const stageUsageKey = (branch, product) => JSON.stringify([branch, product]);
function catalogStageUsage(catalog) {
  let usage = stageUsage.get(catalog);
  if (usage) return usage;
  usage = new Map();
  const registered = new Set(catalog.stages.map(stage => stageUsageKey(nfeProposalKey(stage.branch), nfeProposalKey(stage.label))));
  for (const row of catalog.history) {
    const product = nfeProposalKey(row.product), stage = nfeProposalKey(row.stage), branch = nfeProposalKey(row.branch);
    if (!product || !stage || !branch || !registered.has(stageUsageKey(branch, stage))) continue;
    const pair = stageUsageKey(branch, product);
    if (!usage.has(pair)) usage.set(pair, []);
    const recent = usage.get(pair);
    if (recent.length < NFE_RECENT_STAGE_USES) recent.push(stage);
  }
  stageUsage.set(catalog, usage);
  return usage;
}

function proposedStage(catalog, branchId, productId, number) {
  const product = select(catalog.products, productId);
  if (!product) return '';
  const stages = nfeProposalStages(catalog, branchId);
  if (stages.length < 2) return selectionId(stages[0]);
  const learned = catalog.learning?.stage(number, branchId, productId);
  if (select(stages, learned)) return learned;
  const branch = nfeProposalKey(stages[0].branch);
  const recent = catalogStageUsage(catalog).get(stageUsageKey(branch, nfeProposalKey(product.label)));
  return recent ? selectionId(byLabel(stages, preferredNfeStage(recent))) : '';
}

export function updateNfeProposalBranch(draft, branchId, catalog) {
  return { ...draft, branchId, lines:draft.lines.map(line => ({
    ...line, stageId:proposedStage(catalog, branchId, line.productId, line.number),
  })) };
}

export function updateNfeProposalSupplier(draft, supplierId, catalog) {
  const supplier = select(catalog.suppliers, supplierId);
  const branchId = selectionId(byLabel(catalog.branches, supplier?.branch));
  const accountId = selectionId(byLabel(catalog.accounts, supplier?.account));
  return updateNfeProposalBranch({ ...draft, supplierId, accountId }, branchId, catalog);
}

export function updateNfeProposalProduct(draft, number, productId, catalog) {
  return { ...draft, lines:draft.lines.map(line => line.number === number
    ? { ...line, productId, unitReviewed:false, stageId:proposedStage(catalog, draft.branchId, productId, number) } : line) };
}

export function buildNfeProposal(invoice, fiscal, catalog) {
  const products = catalog.products.map(option => {
    const name = productKey(option.label);
    return { option, name, terms:words(name), unitKey:nfeProposalKey(option.unit) };
  });
  const lines = fiscal.lines.map(line => ({
    number:line.number, productId:catalog.learning?.product(line) || selectionId(proposedProduct(line, products)), stageId:'',
    quantity:line.quantity, unitPrice:line.unitPrice, discount:line.discount, adjustment:line.adjustment,
    date:fiscal.issueDate, dueDate:fiscal.dueDate || '', unitReviewed:false,
  }));
  const header = catalog.learning?.header;
  const supplierId = header?.supplierId || selectionId(proposedSupplier(invoice, catalog.suppliers));
  let draft = updateNfeProposalSupplier({ date:fiscal.issueDate, lines }, supplierId, catalog);
  if (header?.branchId && header.branchId !== draft.branchId) draft = updateNfeProposalBranch(draft, header.branchId, catalog);
  if (header?.accountId) draft.accountId = header.accountId;
  return draft;
}

function decimal(value, label) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^-?\d{1,13}(?:\.\d{1,10})?$/.test(raw)) throw new Error(`Informe ${label} com um número válido.`);
  return new Decimal(raw);
}

export function nfeProposalAmounts(line) {
  const quantity = decimal(line.quantity, 'a quantidade');
  const unitPrice = decimal(line.unitPrice, 'o valor unitário');
  const discount = decimal(line.discount, 'o desconto');
  const adjustment = decimal(line.adjustment, 'os acréscimos/ajustes');
  if (quantity.lte(0) || unitPrice.isNegative() || discount.isNegative()) {
    throw new Error('A quantidade deve ser positiva e o preço e o desconto devem ser iguais ou superiores a zero.');
  }
  if (discount.decimalPlaces() > 2 || adjustment.decimalPlaces() > 2) {
    throw new Error('Informe desconto e ajustes com até duas casas decimais.');
  }
  const gross = quantity.times(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const netAdjustment = adjustment.minus(discount);
  const total = gross.plus(netAdjustment);
  if (total.isNegative() || total.gte(1e13)) throw new Error('O total do item está fora dos limites do lançamento.');
  return { quantity, unitPrice, discount, adjustment, gross, netAdjustment, total };
}

function checkedDate(value, label, optional = false) {
  if (optional && !value) return '';
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0,10) !== value) throw new Error(`Informe ${label} com uma data válida.`);
  return value;
}

export function validateNfeProposal(draft, fiscal, catalog) {
  const supplier = select(catalog.suppliers, draft.supplierId);
  const branch = select(catalog.branches, draft.branchId);
  const account = select(catalog.accounts, draft.accountId);
  if (!supplier || !branch || !account) throw new Error('Selecione um fornecedor, uma filial e uma conta cadastrada.');
  const stages = nfeProposalStages(catalog, branch.id);
  if (!Array.isArray(draft.lines) || draft.lines.length !== fiscal.lines.length || !fiscal.lines.length) {
    throw new Error('A proposta precisa manter todas as linhas da nota fiscal.');
  }
  const date = checkedDate(draft.date, 'a data do pedido');
  let total = new Decimal(0);
  const lines = draft.lines.map((line, index) => {
    const original = fiscal.lines[index];
    if (original.number !== line.number) throw new Error('As linhas da nota fiscal mudaram. Reabra a proposta.');
    const product = select(catalog.products, line.productId);
    const stage = select(stages, line.stageId);
    if (!product) throw new Error(`Selecione um produto cadastrado no item ${line.number}.`);
    if (!product.expenseType) throw new Error(`O produto do item ${line.number} está sem tipo de despesa no cadastro.`);
    if (!stage) throw new Error(`Selecione uma etapa da filial no item ${line.number}.`);
    if (!product.unit) throw new Error(`Cadastre a unidade do produto do item ${line.number}.`);
    if (nfeProposalUnitMismatch(original.unit, product.unit) && line.unitReviewed !== true) {
      throw new Error(`Confira a unidade e a quantidade no item ${line.number}.`);
    }
    const amounts = nfeProposalAmounts(line);
    const rawGross = amounts.quantity.times(amounts.unitPrice);
    // Existing financial reports sum raw quantity × unit price + FRETE.
    // Carry each line's cent rounding in FRETE to keep that sum reconciled.
    const exactAdjustment = amounts.total.minus(rawGross);
    const storedAdjustment = exactAdjustment.toNumber();
    if ([amounts.quantity, amounts.unitPrice].some(value => !value.eq(value.toNumber()))
      || exactAdjustment.minus(storedAdjustment).abs().gt('0.0000001')) {
      throw new Error(`A precisão numérica do item ${line.number} excede o limite do SharePoint.`);
    }
    total = total.plus(amounts.total);
    return {
      number:line.number, product, stage, description:original.description,
      quantity:amounts.quantity.toFixed(), unitPrice:amounts.unitPrice.toFixed(),
      discount:amounts.discount.toFixed(2), adjustment:amounts.adjustment.toFixed(2),
      netAdjustment:storedAdjustment, date:checkedDate(line.date, `a data do item ${line.number}`),
      dueDate:checkedDate(line.dueDate, `o vencimento do item ${line.number}`, true),
      unitReviewed:line.unitReviewed === true,
    };
  });
  return { supplier, branch, account, date, lines, total:total.toFixed(2) };
}
