export const NFE_ORDER_FIELD = 'IDPEDIDO';

export function nfeOrderId(value) {
  const id = String(value ?? '').trim();
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : '';
}

const ORDER_LIST = 'NOTASPENDENTES'; // Source of the PEDIDOS gallery.
const INVOICE_LIST = 'NOTAS_FISCAIS_SEFAZ';

export function createNfeOrderLink({ repository, assertSession = () => {} }) {
  async function resolve(site, name, signal) {
    const list = await repository.resolveList(site, [name], { signal });
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} está indisponível.`);
    return list.id;
  }

  async function loadOptions({ signal } = {}) {
    assertSession();
    const list = await resolve('personal', ORDER_LIST, signal);
    const items = await repository.getItems('personal', list, '$top=100&$expand=fields($select=FORNECEDOR,VALORTOTAL,FILIAL)', { signal });
    assertSession();
    signal?.throwIfAborted();
    if (!Array.isArray(items)) throw new Error('Consulta de pedidos incompleta.');
    return items.map(item => {
      const id = nfeOrderId(item?.id);
      if (!id || !item.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) {
        throw new Error('A consulta retornou um pedido inválido.');
      }
      const supplier = String(item.fields.FORNECEDOR ?? '').trim() || 'Fornecedor não informado';
      const branch = String(item.fields.FILIAL ?? '').trim();
      return { id, supplier, amount:item.fields.VALORTOTAL ?? null, label:`#${id} · ${supplier}${branch ? ' · ' + branch : ''}` };
    });
  }

  async function save({ invoiceId:rawInvoice, orderId:rawOrder, signal }) {
    const invoiceId = nfeOrderId(rawInvoice), orderId = nfeOrderId(rawOrder);
    if (!invoiceId || !orderId) throw new RangeError('ID de nota ou pedido inválido.');
    const active = () => { assertSession(); signal?.throwIfAborted(); };
    active();
    const [invoices, orders] = await Promise.all([
      resolve('company', INVOICE_LIST, signal),
      resolve('personal', ORDER_LIST, signal),
    ]);
    const [target, current] = await Promise.all([
      repository.getItem('personal', orders, orderId, '$expand=fields($select=ID)', { signal }),
      repository.getItem('company', invoices, invoiceId, undefined,
        { signal, restrictedFields:[NFE_ORDER_FIELD], includeVersion:true }),
    ]);
    active();
    if (nfeOrderId(target?.id) !== orderId) throw new Error('O pedido escolhido está indisponível.');
    const eTag = current?.eTag || current?.['@odata.etag'];
    if (nfeOrderId(current?.id) !== invoiceId || !current.fields || !eTag || eTag === '*') {
      throw new Error('Não foi possível verificar a versão atual da nota.');
    }
    const existing = current.fields[NFE_ORDER_FIELD];
    if (nfeOrderId(existing) === orderId) return { invoiceId, orderId };
    if (String(existing ?? '').trim()) throw new Error('A nota já está vinculada. Atualize o relatório.');

    const saved = await repository.updateItem('company', invoices, invoiceId, { [NFE_ORDER_FIELD]:Number(orderId) },
      { eTag, signal, readbackFields:[NFE_ORDER_FIELD] });
    active();
    if (nfeOrderId(saved?.id) !== invoiceId || nfeOrderId(saved?.fields?.[NFE_ORDER_FIELD]) !== orderId) {
      throw new Error('O vínculo do pedido não foi confirmado no SharePoint.');
    }
    return { invoiceId, orderId };
  }

  return Object.freeze({ loadOptions, save });
}
