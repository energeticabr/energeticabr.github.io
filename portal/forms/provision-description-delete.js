const CHILD_LISTS = ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'];
const MAX_PAGES = 100;
const key = value => String(value || '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const authError = error => [401, 403].includes(Number(error?.status));

function stale(message, cause) {
  return Object.assign(new Error(`${message} Abra uma nova prévia e confirme novamente antes de excluir.`, {cause}), {
    code: 'PROVISION_DESCRIPTION_DELETE_STALE', requiresPreview: true,
  });
}
function identity(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{0,14}$/.test(String(value))) {
    throw stale('A identidade do descritivo/provisão é inválida.');
  }
  return String(value);
}
function version(item) {
  const tags = ['eTag', '@odata.etag', 'odata.etag'].map(name => item?.[name]).filter(value => value != null);
  const tag = tags[0];
  // A single HTTP entity tag: no wildcard, header injection, or tag list.
  if (typeof tag !== 'string' || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(tag)
    || /^(?:W\/)?"\*"$/.test(tag) || tags.some(value => value !== tag)) {
    throw stale('A versão ETag do descritivo/provisão não é segura.');
  }
  return tag;
}
function descriptor(columns, logical) {
  if (!Array.isArray(columns) || columns.complete === false || columns.partial || columns.truncated
    || columns.some(column => !object(column))) throw stale('Os metadados não foram comprovados.');
  const internal = columns.filter(column => key(column.name) === logical);
  const matches = internal.length ? internal : columns.filter(column => key(column.displayName) === logical);
  if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0].name)) {
    throw stale(`Os metadados únicos de ${logical} não foram comprovados.`);
  }
  return matches[0];
}
function display(fields, name) {
  const value = fields[name];
  if (value == null) return '';
  if (typeof value !== 'string') throw stale(`O campo ${name} da confirmação é inválido.`);
  return value;
}
function linkValue(fields, name) {
  const value = fields[name];
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw stale('O vínculo DESCRITIVOPROVISAO é inválido.');
  return value.trim() ? identity(value.trim()) : '';
}

/** Frozen public previews are capabilities; versions and retry progress never leave this instance. */
export function createProvisionDescriptionDeletion({repository, siteKey = 'personal', assertSession = () => {}} = {}) {
  const operations = new WeakMap(), busy = new Set();

  function active() {
    try { assertSession(); }
    catch (cause) {
      throw Object.assign(new Error(`A sessão mudou. Abra uma nova prévia e confirme novamente. ${cause?.message || ''}`, {cause}), {
        code: 'PROVISION_DESCRIPTION_DELETE_SESSION', requiresPreview: true,
      });
    }
  }
  async function remote(method, ...args) {
    const readOnly = ['resolveList', 'getColumns', 'getItemsPage', 'getItem'].includes(method);
    for (let attempt = 0; ; attempt++) {
      active();
      try { return await repository[method](siteKey, ...args); }
      catch (cause) {
        // Retry only reads, once, with the same page/item and session. A lost
        // mutation response must still be reconciled by its exact item GET.
        if (!readOnly || attempt !== 0 || !['request_timeout', 'network_error'].includes(cause?.code)) throw cause;
      } finally { active(); } // Includes rejected requests; never recover under another account.
    }
  }
  async function contract() {
    const [parent, child] = await Promise.all([
      remote('resolveList', ['DESCRITIVOPROVISAO']), remote('resolveList', CHILD_LISTS),
    ]);
    if (parent?.status !== 'resolved' || child?.status !== 'resolved'
      || typeof parent.id !== 'string' || !parent.id.trim() || typeof child.id !== 'string' || !child.id.trim() || child.id === parent.id) {
      throw stale('As listas pai e filha não foram comprovadas.');
    }
    const [parentColumns, childColumns] = await Promise.all([
      remote('getColumns', parent.id), remote('getColumns', child.id),
    ]);
    const link = descriptor(childColumns, 'DESCRITIVOPROVISAO');
    if (!object(link.text) || link.text.allowMultipleLines || link.lookup || link.number || link.calculated || link.computed) {
      throw stale('O vínculo DESCRITIVOPROVISAO requer metadados textuais simples.');
    }
    return {
      parentList: parent.id, childList: child.id, link: link.name,
      parentSupplier: descriptor(parentColumns, 'FORNECEDOR').name,
      childSupplier: descriptor(childColumns, 'FORNECEDOR').name,
      product: descriptor(childColumns, 'PRODUTO').name,
      status: descriptor(childColumns, 'STATUS').name,
    };
  }
  function record(item, schema, isParent = false) {
    if (!object(item) || !object(item.fields)) throw stale('O registro do descritivo/provisão é inválido.');
    const id = identity(item.id), eTag = version(item);
    return isParent
      ? {id, eTag, supplier: display(item.fields, schema.parentSupplier)}
      : {id, eTag, supplier: display(item.fields, schema.childSupplier), product: display(item.fields, schema.product),
        status: display(item.fields, schema.status), link: linkValue(item.fields, schema.link)};
  }
  async function scan(schema, parentId) {
    const children = [], seenIds = new Set(), cursors = new Set();
    // Keep default item metadata (including ETag), but avoid fetching every
    // provision field on every page. The complete, unfiltered set is required.
    const fields = [...new Set([schema.link, schema.childSupplier, schema.product, schema.status])];
    const query = `$expand=fields($select=${fields.join(',')})&$top=100`;
    let cursor = '';
    // Enumerate the whole child list. Filtering on pending reminders would hide paid children.
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const page = await remote('getItemsPage', schema.childList, query, {
        pageNumber, maxPages: MAX_PAGES, ...(cursor ? {cursor} : {}),
      });
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean'
        || [page, page.items].some(value => value.complete === false || value.partial || value.truncated)
        || (page.batchCount != null && page.batchCount !== page.items.length)) {
        throw stale('A enumeração das provisões está incompleta ou malformada.');
      }
      for (const item of page.items) {
        if (!object(item) || !object(item.fields)) throw stale('A enumeração retornou um registro inválido.');
        const childId = identity(item.id);
        if (seenIds.has(childId)) throw stale('A enumeração retornou uma identidade de provisão duplicada.');
        seenIds.add(childId);
        const link = linkValue(item.fields, schema.link);
        if (link === parentId) children.push(record(item, schema));
      }
      if (!page.hasMore) {
        if (page.nextLink != null && page.nextLink !== '') throw stale('O cursor de paginação é conflitante.');
        return children.sort((left, right) => Number(left.id) - Number(right.id));
      }
      if (typeof page.nextLink !== 'string' || !page.nextLink.trim() || cursors.has(page.nextLink)) {
        throw stale('A paginação não retornou um cursor único.');
      }
      cursors.add(page.nextLink); cursor = page.nextLink;
    }
    throw stale('A enumeração de todas as provisões excedeu o limite seguro de páginas.');
  }
  function same(actual, expected) {
    return Object.keys(actual).every(name => actual[name] === expected[name]);
  }
  async function read(operation, state, isParent = false) {
    let item;
    try { item = await remote('getItem', isParent ? operation.schema.parentList : operation.schema.childList, state.id, '$expand=fields'); }
    catch (cause) {
      // Only an exact item GET may prove absence, and only after OUR intended DELETE.
      if (Number(cause?.status) !== 404) throw cause;
      if (!state.attempted) throw stale(`O registro ${state.id} desapareceu sem uma exclusão desta operação.`, cause);
      return null;
    }
    const actual = record(item, operation.schema, isParent);
    if (state.done || !same(actual, state)) throw stale(`O registro ${state.id} ou sua versão/vínculo mudou desde a confirmação.`);
    return actual;
  }
  async function verify(operation) {
    const schema = await contract();
    if (!same(schema, operation.schema)) throw stale('O contrato das listas mudou desde a confirmação.');
    const parent = await read(operation, operation.parent, true);
    const linked = await scan(schema, operation.parent.id), listed = new Map(linked.map(child => [child.id, child]));
    for (const child of linked) {
      const expected = operation.children.find(candidate => candidate.id === child.id);
      if (!expected || expected.done || !same(child, expected)) throw stale('O conjunto ou as versões das provisões vinculadas mudou.');
    }
    // Read EVERY confirmed child before the first mutation, including those believed deleted on retry.
    for (const child of operation.children) {
      const actual = await read(operation, child);
      if (actual) {
        if (!listed.has(child.id)) throw stale(`A provisão ${child.id} não consta da enumeração confirmada.`);
      } else {
        if (listed.has(child.id)) throw stale('A enumeração e a leitura individual das provisões não conferem.');
        child.done = true;
      }
    }
    if (!parent) {
      if (linked.length || operation.children.some(child => !child.done)) throw stale('O pai desapareceu antes da conclusão das provisões.');
      operation.parent.done = true;
    }
  }
  async function erase(operation, state, isParent = false) {
    const current = await read(operation, state, isParent);
    if (!current) { state.done = true; return; }
    active();
    state.attempted = true;
    let failure;
    try {
      if (isParent) {
        // Keep an exact recycle receipt so an unexpected new child can retain
        // its ORIGINAL parent ID (including fields/attachments) via restoration.
        state.receipt = await remote('recycleItem', operation.schema.parentList, state.id, {eTag: state.eTag});
      } else await remote('deleteItem', operation.schema.childList, state.id, {eTag: state.eTag});
    }
    catch (cause) {
      if (cause.requiresPreview || authError(cause)) throw cause;
      if (Number(cause?.status) === 412) throw stale(`A versão do registro ${state.id} mudou durante a exclusão.`, cause);
      failure = cause;
    }
    // Success and lost responses both require absence of the exact intended item.
    if (await read(operation, state, isParent)) {
      throw failure || new Error(`A exclusão do registro ${state.id} ainda não foi comprovada. Tente novamente.`);
    }
    state.done = true;
  }
  async function restoreParent(operation) {
    const state = operation.parent;
    if (!state.receipt) throw stale(`A exclusão do descritivo ${state.id} não pôde ser finalizada com segurança. `
      + 'O retorno da lixeira não foi recebido; confira e restaure o descritivo pela lixeira do SharePoint antes de continuar.');
    let restored;
    try { restored = await remote('getItem', operation.schema.parentList, state.id, '$expand=fields'); }
    catch (cause) { if (Number(cause?.status) !== 404) throw cause; }
    if (!restored) {
      let failure;
      try { await remote('restoreRecycledItem', operation.schema.parentList, state.id, state.receipt); }
      catch (cause) { if (cause.requiresPreview || authError(cause)) throw cause; failure = cause; }
      try { restored = await remote('getItem', operation.schema.parentList, state.id, '$expand=fields'); }
      catch (cause) { throw failure || cause; }
    }
    const current = record(restored, operation.schema, true);
    if (current.id !== state.id) throw stale('A restauração não devolveu o descritivo original.');
    state.done = false;
    throw stale(`O descritivo ${state.id} foi restaurado para preservar os vínculos. ${operation.restoreReason}`);
  }
  async function preview(value) {
    active();
    const id = identity(value), schema = await contract();
    // These are independent reads. Keep the complete, fresh child enumeration
    // (including paid/legacy whitespace links), but do not wait for the parent
    // response before starting its pages. Mutations still use verify() below.
    const [item, children] = await Promise.all([
      remote('getItem', schema.parentList, id, '$expand=fields'), scan(schema, id),
    ]);
    const parent = record(item, schema, true);
    if (parent.id !== id) throw stale('A identidade do descritivo consultado não confere.');
    const context = Object.freeze({id, supplier: parent.supplier,
      children: Object.freeze(children.map(child => Object.freeze({id: child.id, supplier: child.supplier, product: child.product, status: child.status}))),
    });
    operations.set(context, {schema, parent: {...parent, attempted: false, done: false},
      children: children.map(child => ({...child, attempted: false, done: false})), invalid: null, result: null});
    return context;
  }
  async function remove(context, options = {}) {
    const operation = object(context) ? operations.get(context) : null;
    if (!operation || options?.confirm !== true) throw new Error('A exclusão requer a prévia original e confirmação explícita.');
    if (busy.has(operation.parent.id)) throw new Error('A exclusão deste descritivo já está em andamento.');
    busy.add(operation.parent.id);
    try {
      active();
      if (operation.invalid) throw operation.invalid;
      if (operation.result) return operation.result;
      if (operation.restoreReason) await restoreParent(operation);
      if (typeof repository.recycleItem !== 'function' || typeof repository.restoreRecycledItem !== 'function') {
        throw stale('A exclusão recuperável do descritivo não está disponível. Nenhum registro foi excluído.');
      }
      await verify(operation);
      if (!operation.parent.done) {
        for (const child of operation.children) {
          if (child.done) continue;
          await read(operation, operation.parent, true);
          await erase(operation, child);
        }
        // A fresh complete enumeration must prove no linked children before deleting the parent.
        await verify(operation);
        if (operation.children.some(child => !child.done)) throw stale('Ainda existem provisões vinculadas ao descritivo.');
        if (!operation.parent.done) await erase(operation, operation.parent, true);
      }
      // Text foreign keys have no atomic server-side constraint. Recycle the
      // parent reversibly and verify AFTER that boundary, never pretend this is
      // a cross-list transaction. An unshown concurrent child is NOT deleted.
      try {
        if ((await scan(operation.schema, operation.parent.id)).length) {
          throw new Error('Outra provisão foi vinculada durante a exclusão.');
        }
      } catch (cause) {
        operation.restoreReason = cause?.message || 'Não foi possível conferir os vínculos depois da exclusão.';
        await restoreParent(operation);
      }
      operation.result = Object.freeze({id: operation.parent.id,
        deletedChildIds: Object.freeze(operation.children.map(child => child.id)), deleted: true});
      return operation.result;
    } catch (cause) {
      const requiresPreview = Boolean(cause.requiresPreview || authError(cause));
      if (requiresPreview) operation.invalid = cause;
      if (operation.parent.attempted || operation.children.some(child => child.attempted)) {
        const deletedChildIds = Object.freeze(operation.children.filter(child => child.done).map(child => child.id));
        const error = Object.assign(new Error(`A exclusão do descritivo ${operation.parent.id} ficou incompleta e pode ter realizado ação parcial. `
          + `Provisões com exclusão comprovada: ${deletedChildIds.join(', ') || 'nenhuma'}. `
          + (requiresPreview ? 'Abra uma nova prévia e confirme novamente para tentar concluir. ' : 'Tente novamente com esta mesma confirmação para concluir. ')
          + (cause?.message || ''), {cause}), {
          code: 'PROVISION_DESCRIPTION_DELETE_INCOMPLETE', id: operation.parent.id, deletedChildIds,
          requiresPreview, retryable: !requiresPreview,
        });
        throw error;
      }
      throw cause;
    } finally { busy.delete(operation.parent.id); }
  }
  return Object.freeze({preview, remove});
}
