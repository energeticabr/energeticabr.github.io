const key = value => String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const positiveId = value => {
  const id = String(value ?? '').trim();
  if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('O descritivo da provisão requer ID positivo.');
  return id;
};
const unavailable = () => Object.assign(new Error('O descritivo da provisão não está mais disponível.'), {
  code: 'provision_description_not_found',
});

/** Share the exact metadata contract between the card and the complete reader. */
export function provisionDescriptionLinkColumn(columns, { required = true } = {}) {
  const candidates = (Array.isArray(columns) ? columns : []).filter(column => column?.name && column.text && !column.hidden && !column.computed
    && [column.name, column.displayName].some(name => key(name) === 'DESCRITIVOPROVISAO'));
  const canonical = candidates.filter(column => key(column.name) === 'DESCRITIVOPROVISAO');
  const selected = canonical.length ? canonical : candidates;
  if (!selected.length && !required) return '';
  if (selected.length !== 1) throw new Error('Os metadados da coluna de vínculo do descritivo não são únicos.');
  return selected[0].name;
}

/** Read a fresh, complete group; never reuse the gallery's filtered/page rows. */
export async function loadProvisionDescriptionGroup({ repository, siteKey, normalizeItem, assertSession }, rawId, { signal } = {}) {
  const parentId = positiveId(rawId);
  const active = () => {
    assertSession();
    if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
  };
  const options = signal ? { signal } : {};
  async function read(operation) {
    active();
    const result = await operation();
    active();
    return result;
  }
  async function resolve(aliases) {
    const list = await read(() => repository.resolveList(siteKey, aliases, options));
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${aliases[0]} não está disponível nesta sessão.`);
    return list.id;
  }
  function normalize(item, expectedId) {
    const id = positiveId(item?.id);
    if (!item.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) throw new Error('A resposta da provisão não contém campos válidos.');
    const fieldId = Object.entries(item.fields).find(([name]) => key(name) === 'ID')?.[1];
    if ((expectedId && id !== expectedId) || (fieldId != null && String(fieldId).trim() !== id)) {
      throw new Error('A identidade do registro retornado não corresponde à consulta.');
    }
    const row = normalizeItem(item);
    if (!row || row.id !== id) throw new Error('A identidade da provisão não pôde ser confirmada.');
    return row;
  }
  if (typeof repository.getItem !== 'function' || typeof repository.getColumns !== 'function') {
    throw new Error('A consulta de descritivo e metadados não está disponível.');
  }
  const parents = await resolve(['DESCRITIVOPROVISAO']);
  async function parent() {
    let item;
    try { item = await read(() => repository.getItem(siteKey, parents, parentId, '$expand=fields', options)); }
    catch (error) {
      active();
      if (Number(error?.status) === 404 || String(error?.code).toLowerCase() === 'itemnotfound') throw unavailable();
      throw error;
    }
    if (!item) throw unavailable();
    return normalize(item, parentId);
  }
  await parent();
  const children = await resolve(['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS']);
  const columns = await read(() => repository.getColumns(siteKey, children, options));
  const linkName = provisionDescriptionLinkColumn(columns);
  const rows = [], seenIds = new Set(), seenCursors = new Set();
  let cursor = '';
  for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
    const page = await read(() => repository.getItemsPage(siteKey, children, '$expand=fields&$top=100', {
      pageNumber, maxPages: 100, ...options, ...(cursor ? { cursor } : {}),
    }));
    if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || page.complete === false || page.partial || page.truncated) {
      throw new Error('A consulta completa das provisões não foi confirmada.');
    }
    for (const item of page.items) {
      const row = normalize(item);
      if (seenIds.has(row.id)) throw new Error('A consulta retornou uma provisão duplicada.');
      seenIds.add(row.id);
      if (String(item.fields[linkName] ?? '').trim() === parentId) rows.push(row);
    }
    if (!page.hasMore) {
      if (page.nextLink) throw new Error('Cursor de provisões inconsistente.');
      // Confirm the parent still exists after all child pages have been read.
      const description = await parent();
      rows.sort((a, b) => Number(a.id) - Number(b.id));
      return Object.freeze({ description, provisions: Object.freeze(rows) });
    }
    if (typeof page.nextLink !== 'string' || !page.nextLink || seenCursors.has(page.nextLink)) {
      throw new Error('A paginação das provisões não retornou cursor único.');
    }
    seenCursors.add(page.nextLink);
    cursor = page.nextLink;
  }
  throw new Error('A consulta das provisões excedeu o limite seguro de páginas.');
}
