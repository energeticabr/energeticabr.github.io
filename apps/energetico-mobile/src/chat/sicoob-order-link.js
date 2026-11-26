import Decimal from 'decimal.js';
import { normalizeSearchText } from '../../../../portal/core/search-text.js';
import { provisionDateKey } from '../../../../portal/forms/provision-parent-due.js';
import { fiscalSupplierSimilarity } from './dda-provision-link.js';
import { isImportedFinancialMovement, SICOOB_ORDER_FIELD } from './financial-gallery-models.js';

export { SICOOB_ORDER_FIELD };
export const SICOOB_ADDITIONAL_ORDERS_FIELD = 'SICOOB_PEDIDOS_ADICIONAIS';
export const SICOOB_UNLINKED_REVIEW_FIELD = 'SICOOB_SEM_VINCULACAO_REGULAR';

export function sicoobOrderId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const id = String(value).trim();
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : '';
}

export function sicoobAmountCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  let raw = value;
  if (typeof raw === 'string') {
    raw = raw.trim().replace(/^R\$\s*/i, '');
    if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(raw)) raw = raw.replaceAll('.', '').replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  } else if (!Number.isFinite(raw)) return null;
  const cents = new Decimal(raw).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Number.isSafeInteger(cents) ? cents : null;
}

const placeholders = new Set([
  'na', 'n a', 'n d', 'nd', 'identificacao pendente', 'nome pendente', 'a identificar',
  'nao informado', 'nao informada', 'nao identificado', 'nao identificada', 'nao disponivel', 'nao se aplica',
  'sem nome', 'sem identificacao', 'sem informacao', 'desconhecido', 'desconhecida', 'pendente',
]);

const genericSupplierWords = new Set([
  'recebedor', 'beneficiario', 'favorecido', 'fornecedor', 'empresa', 'cliente', 'pessoa', 'fisica', 'juridica',
  'comercial', 'comercio', 'comerciais', 'servico', 'servicos', 'industria', 'industrial', 'brasil',
  'engenharia', 'construcao', 'construcoes', 'concreto', 'concretos', 'material', 'materiais',
  'ltda', 'limitada', 'eireli', 'epp', 'me', 'mei', 'sa', 's', 'a', 'e', 'o', 'de', 'da', 'do', 'dos', 'das',
]);

function hasSupplierIdentity(value) {
  if (typeof value !== 'string') return false;
  const name = normalizeSearchText(value).replace(/[^a-z0-9]+/g, ' ').trim();
  const descriptor = name.replace(/^(?:fornecedor|recebedor|beneficiario|favorecido|cliente|empresa)\s+/, '');
  return !placeholders.has(descriptor) && name.split(' ').some(word => /[a-z]/.test(word) && !genericSupplierWords.has(word));
}

export function rankSicoobOrderOptions(options, { supplier, amount, date } = {}) {
  const wanted = sicoobAmountCents(amount);
  const named = hasSupplierIdentity(supplier);
  return options.map(option => {
    const amountMatch = wanted > 0 && sicoobAmountCents(option.amount) === wanted;
    const dateMatch = Boolean(date) && option.date === date;
    const similarity = named && hasSupplierIdentity(option.supplier) ? fiscalSupplierSimilarity(supplier, option.supplier) : 0;
    const nameMatch = similarity >= 0.5;
    const priority = 2 * Number(amountMatch) + Number(nameMatch);
    const matchDetail = [amountMatch && 'Valor igual', nameMatch && 'Nome/razão social semelhante'].filter(Boolean).join(' e ');
    return { ...option, dateMatch, amountMatch, priority, similarity, recommended:priority > 0, matchDetail };
  }).sort((a, b) => b.priority - a.priority || b.similarity - a.similarity || Number(b.id) - Number(a.id));
}

export function rankDdaOrderOptions(options, { supplier, amount, due } = {}) {
  const wanted = sicoobAmountCents(amount);
  const originalDue = Date.parse(provisionDateKey(due));
  const ranked = options.map(option => {
    const totalMatch = wanted > 0 && sicoobAmountCents(option.amount) === wanted;
    let closestDue = '';
    let distance = Infinity;
    for (const value of option.dueDates ?? []) {
      const day = provisionDateKey(value);
      const difference = Math.abs(Date.parse(day) - originalDue);
      if (difference < distance || (difference === distance && day < closestDue)) {
        closestDue = day;
        distance = difference;
      }
    }
    return { ...option, totalMatch, closestDue, distance,
      similarity: fiscalSupplierSimilarity(supplier, option.supplier) };
  });
  return ranked.sort((a, b) => Number(b.totalMatch) - Number(a.totalMatch)
    || (a.totalMatch ? a.distance - b.distance : 0)
    || b.similarity - a.similarity || Number(a.id) - Number(b.id))
    .map((option, index) => ({ ...option,
      recommended: index === 0 && option.totalMatch && Boolean(option.closestDue),
    }));
}

const ORDER_LIST = 'NOTASPENDENTES';
const MOVEMENT_LIST = 'MOVIMENTACOESFINANCEIRAS';
const fieldObject = value => value && typeof value === 'object' && !Array.isArray(value);
const scalar = value => value == null || typeof value === 'string' || typeof value === 'number';
const blank = value => value == null || (typeof value === 'string' && !value.trim());
const linkFields = [SICOOB_ORDER_FIELD, SICOOB_ADDITIONAL_ORDERS_FIELD];
const versionedMovementFields = [...linkFields, 'ORIGEMMOVIMENTACAO'];
const reviewFields = [...versionedMovementFields, SICOOB_UNLINKED_REVIEW_FIELD];
const ORDER_LOOKUP_BATCH_SIZE = 6;

function normalizeOrderIds(values) {
  if (!Array.isArray(values)) return null;
  const ids = values.map(sicoobOrderId);
  return ids.every(Boolean) ? [...new Set(ids)] : null;
}

export function sicoobLinkedOrderIds(fields, { strict = false } = {}) {
  const primary = fields?.[SICOOB_ORDER_FIELD];
  const additional = fields?.[SICOOB_ADDITIONAL_ORDERS_FIELD];
  const values = blank(primary) ? [] : [primary];
  if (!blank(additional)) {
    if (typeof additional === 'string') values.push(...additional.split(','));
    else if (strict) return null;
  }
  return strict ? normalizeOrderIds(values) : [...new Set(values.map(sicoobOrderId).filter(Boolean))];
}

export const sameSicoobOrderIds = (left, right) =>
  Array.isArray(left) && Array.isArray(right) && left.length === right.length && right.every(id => left.includes(id));

function movementVersion(item, movementId) {
  const eTag = item?.eTag ?? item?.['@odata.etag'];
  if (sicoobOrderId(item?.id) !== movementId || !fieldObject(item?.fields) ||
    typeof eTag !== 'string' || !/^(?:W\/)?"[^"\s]+"$/.test(eTag)) {
    throw new Error('Não foi possível verificar a versão atual da movimentação.');
  }
  if (!isImportedFinancialMovement(item.fields)) throw new Error('A movimentação não foi importada do Sicoob.');
  return eTag;
}

function orderSupplier(order) {
  const supplier = order?.fields?.FORNECEDOR;
  if (typeof supplier !== 'string') return '';
  const name = normalizeSearchText(supplier).replace(/[^a-z0-9]+/g, ' ').trim();
  return name && !placeholders.has(name) ? supplier.trim() : '';
}

export function createSicoobOrderLink({
  repository, orderRepository = repository, siteKey = 'personal', assertSession = () => {}, loadLaunchGroup,
}) {
  function active(signal) {
    assertSession();
    signal?.throwIfAborted();
  }

  async function resolve(source, name, signal) {
    active(signal);
    const list = await source.resolveList(siteKey, [name], { signal });
    active(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} está indisponível.`);
    return list.id;
  }

  async function loadOptions({ signal, amount, due } = {}) {
    const list = await resolve(orderRepository, ORDER_LIST, signal);
    const items = await orderRepository.getItems(siteKey, list, '$top=100&$expand=fields($select=FORNECEDOR,VALORTOTAL,FILIAL,DATAPEDIDO)', { signal });
    active(signal);
    if (!Array.isArray(items)) throw new Error('Consulta de pedidos incompleta.');
    const ids = new Set();
    const options = items.map(item => {
      const id = sicoobOrderId(item?.id);
      const fields = item?.fields;
      if (!id || ids.has(id) || !fieldObject(fields) || ![fields.FORNECEDOR, fields.VALORTOTAL, fields.FILIAL].every(scalar)) {
        throw new Error('A consulta retornou um pedido inválido.');
      }
      ids.add(id);
      const supplier = String(fields.FORNECEDOR ?? '').trim() || 'Fornecedor não informado';
      const branch = String(fields.FILIAL ?? '').trim();
      const date = provisionDateKey(fields.DATAPEDIDO);
      const details = branch ? `${supplier} · ${branch}` : supplier;
      return { id, supplier, amount:fields.VALORTOTAL ?? null, date, details, label:`#${id} · ${details}` };
    });
    const wanted = sicoobAmountCents(amount);
    if (!loadLaunchGroup || !(wanted > 0) || !provisionDateKey(due)) return options;

    const matches = options.filter(option => sicoobAmountCents(option.amount) === wanted);
    const dueDatesByOrder = new Map();
    try {
      for (let start = 0; start < matches.length; start += ORDER_LOOKUP_BATCH_SIZE) {
        const batch = matches.slice(start, start + ORDER_LOOKUP_BATCH_SIZE);
        await Promise.all(batch.map(async ({ id }) => {
          const launches = await loadLaunchGroup(id, { signal });
          const days = launches.map(({ fields }) => provisionDateKey(fields['DATA PGTO PREVISTO'])).filter(Boolean);
          dueDatesByOrder.set(id, [...new Set(days)].sort());
        }));
        active(signal);
      }
    } catch (error) {
      active(signal);
      if (error?.name === 'AbortError') throw error;
      // An incomplete date comparison cannot establish the closest order.
      return options.map(option => ({ ...option, dueLookupIncomplete: true }));
    }
    return options.map(option => dueDatesByOrder.has(option.id)
      ? { ...option, dueDates: dueDatesByOrder.get(option.id) }
      : option);
  }

  async function loadSuppliers(orderIds, { signal } = {}) {
    const ids = [...new Set(orderIds.map(sicoobOrderId).filter(Boolean))];
    const suppliers = new Map();
    let incomplete = false;
    if (!ids.length) return { suppliers, incomplete };
    const list = await resolve(orderRepository, ORDER_LIST, signal);
    for (let start = 0; start < ids.length; start += ORDER_LOOKUP_BATCH_SIZE) {
      active(signal);
      const batch = await Promise.allSettled(ids.slice(start, start + ORDER_LOOKUP_BATCH_SIZE).map(async id => {
        const order = await readOrder(list, id, signal);
        const supplier = orderSupplier(order);
        if (sicoobOrderId(order?.id) === id && supplier) suppliers.set(id, supplier);
      }));
      incomplete ||= batch.some(result => result.status === 'rejected');
    }
    active(signal);
    return { suppliers, incomplete };
  }

  async function hasPendingUnlinked({ signal } = {}) {
    const list = await resolve(repository, MOVEMENT_LIST, signal);
    const query = new URLSearchParams({
      '$select': ['ID', ...reviewFields].join(','),
      '$filter': "ORIGEMMOVIMENTACAO eq 'SICOOB'",
    });
    const items = await repository.getItems(siteKey, list, query, { signal });
    active(signal);
    if (!Array.isArray(items) || items.some(item => !sicoobOrderId(item?.id) || !fieldObject(item?.fields))) {
      throw new Error('Consulta de transações incompleta.');
    }
    return items.some(({ fields }) => isImportedFinancialMovement(fields)
      && sicoobLinkedOrderIds(fields).length === 0 && fields[SICOOB_UNLINKED_REVIEW_FIELD] !== true);
  }

  async function saveReview({ movementId: rawMovement, reviewed, signal }) {
    const movementId = sicoobOrderId(rawMovement);
    if (!movementId || typeof reviewed !== 'boolean') throw new RangeError('Regularização Sicoob inválida.');
    const list = await resolve(repository, MOVEMENT_LIST, signal);
    const current = await repository.getItem(siteKey, list, movementId, undefined,
      { signal, restrictedFields: reviewFields, includeVersion: true });
    active(signal);
    const eTag = movementVersion(current, movementId);
    if (sicoobLinkedOrderIds(current.fields, { strict: true })?.length !== 0) {
      throw new Error('O vínculo da movimentação mudou. Atualize o relatório.');
    }
    const previous = current.fields[SICOOB_UNLINKED_REVIEW_FIELD];
    if (previous != null && typeof previous !== 'boolean') throw new Error('Regularização existente inválida.');
    const receipt = { movementId, reviewed };
    if ((previous === true) === reviewed) return receipt;
    const saved = await repository.updateItem(siteKey, list, movementId, { [SICOOB_UNLINKED_REVIEW_FIELD]: reviewed },
      { eTag, signal, readbackFields: reviewFields });
    active(signal);
    if (sicoobOrderId(saved?.id) !== movementId || !isImportedFinancialMovement(saved?.fields) ||
      sicoobLinkedOrderIds(saved.fields, { strict: true })?.length !== 0 || saved.fields[SICOOB_UNLINKED_REVIEW_FIELD] !== reviewed) {
      throw new Error('A regularização não foi confirmada no SharePoint.');
    }
    return receipt;
  }

  async function save({ movementId:rawMovement, orderIds, expectedOrderIds = [], signal }) {
    const movementId = sicoobOrderId(rawMovement);
    const selected = normalizeOrderIds(orderIds);
    const expected = normalizeOrderIds(expectedOrderIds);
    if (!movementId || !selected?.length || !expected) {
      throw new RangeError('ID de movimentação ou pedido inválido.');
    }

    const [movements, orders] = await Promise.all([
      resolve(repository, MOVEMENT_LIST, signal), resolve(orderRepository, ORDER_LIST, signal),
    ]);
    active(signal);
    const current = await repository.getItem(siteKey, movements, movementId, undefined,
      { signal, restrictedFields: versionedMovementFields, includeVersion:true });
    active(signal);
    const eTag = movementVersion(current, movementId);
    const existing = sicoobLinkedOrderIds(current.fields, { strict: true });
    if (!existing) throw new Error('O vínculo registrado é inválido. Atualize o relatório.');
    const unchanged = sameSicoobOrderIds(existing, selected);
    if (!unchanged && !sameSicoobOrderIds(existing, expected)) {
      throw new Error('O vínculo da movimentação mudou. Atualize o relatório.');
    }

    // Keep the first existing order in the numeric column while it is selected.
    const next = [...existing.filter(id => selected.includes(id)), ...selected.filter(id => !existing.includes(id))];
    const suppliers = [];
    for (let start = 0; start < next.length; start += ORDER_LOOKUP_BATCH_SIZE) {
      const batch = next.slice(start, start + ORDER_LOOKUP_BATCH_SIZE);
      const targets = await Promise.all(batch.map(id => readOrder(orders, id, signal)));
      active(signal);
      if (targets.some((target, index) => sicoobOrderId(target?.id) !== batch[index])) {
        throw new Error('Um dos pedidos escolhidos está indisponível.');
      }
      suppliers.push(...targets.map(orderSupplier));
    }
    const receipt = { movementId, orderIds: next, suppliers };
    if (unchanged) return receipt;

    const [primary, ...additional] = next;
    const saved = await repository.updateItem(siteKey, movements, movementId, {
      [SICOOB_ORDER_FIELD]: Number(primary),
      [SICOOB_ADDITIONAL_ORDERS_FIELD]: additional.join(','),
    }, { eTag, signal, readbackFields: linkFields });
    active(signal);
    if (sicoobOrderId(saved?.id) !== movementId || sicoobOrderId(saved?.fields?.[SICOOB_ORDER_FIELD]) !== primary
      || !sameSicoobOrderIds(sicoobLinkedOrderIds(saved.fields, { strict: true }), next)) {
      throw new Error('O vínculo dos pedidos não foi confirmado no SharePoint.');
    }
    return receipt;
  }

  async function readOrder(orders, orderId, signal) {
    try {
      return await orderRepository.getItem(siteKey, orders, orderId, '$expand=fields($select=FORNECEDOR)', { signal });
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  return Object.freeze({ loadOptions, loadSuppliers, hasPendingUnlinked, saveReview, save });
}

