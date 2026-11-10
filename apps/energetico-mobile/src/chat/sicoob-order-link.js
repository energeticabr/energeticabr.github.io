import Decimal from 'decimal.js';
import { normalizeSearchText } from '../../../../portal/core/search-text.js';
import { fiscalSupplierSimilarity } from './dda-provision-link.js';
import { isImportedFinancialMovement, SICOOB_ORDER_FIELD } from './financial-gallery-models.js';

export { SICOOB_ORDER_FIELD };

export function sicoobOrderId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const id = String(value).trim();
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : '';
}

function positiveCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  let raw = value;
  if (typeof raw === 'string') {
    raw = raw.trim().replace(/^R\$\s*/i, '');
    if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(raw)) raw = raw.replaceAll('.', '').replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  } else if (!Number.isFinite(raw)) return null;
  const cents = new Decimal(raw).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
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

export function rankSicoobOrderOptions(options, { supplier, amount } = {}) {
  const wanted = positiveCents(amount);
  const named = hasSupplierIdentity(supplier);
  return options.map(option => {
    const amountMatch = wanted !== null && positiveCents(option.amount) === wanted;
    const similarity = named && hasSupplierIdentity(option.supplier) ? fiscalSupplierSimilarity(supplier, option.supplier) : 0;
    const nameMatch = similarity >= 0.5;
    const priority = 2 * Number(amountMatch) + Number(nameMatch);
    const matchDetail = [amountMatch && 'Valor igual', nameMatch && 'Nome/razão social semelhante'].filter(Boolean).join(' e ');
    return { ...option, priority, similarity, recommended:priority > 0, matchDetail };
  }).sort((a, b) => b.priority - a.priority || b.similarity - a.similarity || Number(b.id) - Number(a.id));
}

const ORDER_LIST = 'NOTASPENDENTES';
const MOVEMENT_LIST = 'MOVIMENTACOESFINANCEIRAS';
const fieldObject = value => value && typeof value === 'object' && !Array.isArray(value);
const scalar = value => value == null || typeof value === 'string' || typeof value === 'number';
const blank = value => value == null || (typeof value === 'string' && !value.trim());

export function createSicoobOrderLink({ repository, orderRepository = repository, siteKey = 'personal', assertSession = () => {} }) {
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

  async function loadOptions({ signal } = {}) {
    const list = await resolve(orderRepository, ORDER_LIST, signal);
    const items = await orderRepository.getItems(siteKey, list, '$top=100&$expand=fields($select=FORNECEDOR,VALORTOTAL,FILIAL)', { signal });
    active(signal);
    if (!Array.isArray(items)) throw new Error('Consulta de pedidos incompleta.');
    const ids = new Set();
    return items.map(item => {
      const id = sicoobOrderId(item?.id);
      const fields = item?.fields;
      if (!id || ids.has(id) || !fieldObject(fields) || ![fields.FORNECEDOR, fields.VALORTOTAL, fields.FILIAL].every(scalar)) {
        throw new Error('A consulta retornou um pedido inválido.');
      }
      ids.add(id);
      const supplier = String(fields.FORNECEDOR ?? '').trim() || 'Fornecedor não informado';
      const branch = String(fields.FILIAL ?? '').trim();
      return { id, supplier, amount:fields.VALORTOTAL ?? null, label:`#${id} · ${supplier}${branch ? ' · ' + branch : ''}` };
    });
  }

  async function save({ movementId:rawMovement, orderId:rawOrder, expectedOrderId, signal }) {
    const movementId = sicoobOrderId(rawMovement), orderId = sicoobOrderId(rawOrder);
    const expected = sicoobOrderId(expectedOrderId);
    if (!movementId || !orderId || (!expected && !blank(expectedOrderId))) {
      throw new RangeError('ID de movimentação ou pedido inválido.');
    }

    const [movements, orders] = await Promise.all([
      resolve(repository, MOVEMENT_LIST, signal), resolve(orderRepository, ORDER_LIST, signal),
    ]);
    active(signal);
    const [target, current] = await Promise.all([
      readOrder(orders, orderId, signal),
      repository.getItem(siteKey, movements, movementId, undefined,
        { signal, restrictedFields:[SICOOB_ORDER_FIELD, 'ORIGEMMOVIMENTACAO'], includeVersion:true }),
    ]);
    active(signal);
    if (sicoobOrderId(target?.id) !== orderId) throw new Error('O pedido escolhido está indisponível.');
    const eTag = current?.eTag ?? current?.['@odata.etag'];
    if (sicoobOrderId(current?.id) !== movementId || !fieldObject(current?.fields) ||
      typeof eTag !== 'string' || !/^(?:W\/)?"[^"\s]+"$/.test(eTag)) {
      throw new Error('Não foi possível verificar a versão atual da movimentação.');
    }
    if (!isImportedFinancialMovement(current.fields)) throw new Error('A movimentação não foi importada do Sicoob.');
    const rawExisting = current.fields[SICOOB_ORDER_FIELD];
    const existing = sicoobOrderId(rawExisting);
    if (!existing && !blank(rawExisting)) {
      throw new Error('O vínculo registrado é inválido. Atualize o relatório.');
    }
    if (existing === orderId) return { movementId, orderId };
    if (existing !== expected) throw new Error('O vínculo da movimentação mudou. Atualize o relatório.');

    const saved = await repository.updateItem(siteKey, movements, movementId, { [SICOOB_ORDER_FIELD]:Number(orderId) },
      { eTag, signal, readbackFields:[SICOOB_ORDER_FIELD] });
    active(signal);
    if (sicoobOrderId(saved?.id) !== movementId || sicoobOrderId(saved?.fields?.[SICOOB_ORDER_FIELD]) !== orderId) {
      throw new Error('O vínculo do pedido não foi confirmado no SharePoint.');
    }
    return { movementId, orderId };
  }

  async function readOrder(orders, orderId, signal) {
    try {
      return await orderRepository.getItem(siteKey, orders, orderId, '$expand=fields($select=ID)', { signal });
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  return Object.freeze({ loadOptions, save });
}

