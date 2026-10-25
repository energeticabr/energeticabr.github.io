import assert from 'node:assert/strict';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';

export const schemaFields = ['Title', 'IDFORNECEDORORIGEM', 'CARGO', 'EMPREITEIRO', 'STATUS', 'FILIAL', 'TIPO', 'CIDADE',
  'VINCULO', 'HOMOLOGACAO', 'TIPODOCUMENTO', 'DOCUMENTOFORNECEDOR', 'TELEFONECONTATO', 'WHATSAPP', 'EMAIL', 'PROFISSAO',
  'FORMAPGTO', 'VLRDIARIO', 'HORASTRABALHO', 'MEDICAOATUAL', 'IMOVEL', 'ENDERECO', 'DESCRITIVOETAPAATUAL',
  'ATIVIDADEEXERCIDA', 'DATAADMISSAO', 'DATADESLIGAMENTO', 'DATANASCIMENTO'];
export function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}
export function syntheticTransport({ storage = memoryStorage(), accountKey = 'synthetic-account', siteIdentity = 'synthetic.sharepoint.com/sites/rh' } = {}) {
  const source = { id: '17', eTag: '"1"', fields: { STATUS: 'ATIVO', EMPREITEIRO: 'SIM', Title: 'SYNTHETIC SOURCE NAME' } };
  const target = { id: '4', eTag: '"1"', createdBy: { user: { displayName: 'Synthetic creator' } },
    lastModifiedBy: { user: { displayName: 'Synthetic editor' } }, createdDateTime: '2026-01-21T12:00:00Z', lastModifiedDateTime: '2026-01-22T12:00:00Z',
    fields: { ...Object.fromEntries(schemaFields.map(name => [name, 'synthetic-' + name])), Title: 'Synthetic employee', CARGO: 'PEDREIRO III',
      STATUS: 'ATIVO', EMPREITEIRO: 'SIM', DATAADMISSAO: '2026-01-20', DATADESLIGAMENTO: null, IDFORNECEDORORIGEM: '17' } };
  const calls = [], writes = [], tokens = [];
  let targetFailure = '', sourceFailure = '', alive = true, pageMode = 'normal';
  const response = (payload, status = 200) => new Response(status === 204 ? null : JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json' },
  });
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url), path = parsed.pathname, query = parsed.searchParams;
    calls.push({ path, query, options });
    assert.ok(!path.includes('RoleAssignments') && !path.includes('permissions'), 'no ACL reads');
    if (options.method === 'PATCH') {
      const record = path.includes('/source/') ? source : target;
      const fields = JSON.parse(options.body); writes.push({ list: record === source ? 'source' : 'target', fields, eTag: options.headers['If-Match'] });
      if (record === target && targetFailure === '412') {
        targetFailure = ''; target.eTag = '"8"'; target.fields.FILIAL = 'Concurrent branch';
        return response({ error: { message: 'Synthetic conflict' } }, 412);
      }
      if (record === source && sourceFailure === '412') {
        sourceFailure = ''; source.eTag = '"9"';
        return response({ error: { message: 'Synthetic source conflict' } }, 412);
      }
      if ((record === target && targetFailure === 'unknown') || (record === source && sourceFailure === 'unknown')) throw new TypeError('Synthetic connection lost');
      if (options.headers['If-Match'] !== record.eTag) return response({ error: { message: 'Synthetic stale ETag' } }, 412);
      Object.assign(record.fields, fields); record.eTag = '"' + (Number(record.eTag.replaceAll('"', '')) + 1) + '"';
      if ((record === target && targetFailure === 'lost') || (record === source && sourceFailure === 'lost')) throw new TypeError('Synthetic response lost');
      return response(null, 204);
    }
    if (path.endsWith('/columns')) {
      return response({ value: path.includes('/source/') ? [
        { name: 'Title', displayName: 'CADASTRO', text: {} },
        { name: 'STATUS', displayName: 'STATUS', choice: { choices: ['ATIVO', 'INATIVO'] } },
        { name: 'EMPREITEIRO', displayName: 'EMPREITEIRO', choice: { choices: ['SIM', 'NÃO'] } },
      ] : schemaFields.map(name => ({ name, displayName: name, text: {} })) });
    }
    if (/\/items\/\d+$/.test(path)) {
      const record = structuredClone(path.includes('/source/') ? source : target);
      const selected = query.get('$expand')?.match(/fields\(\$select=([^)]*)\)/)?.[1];
      if (selected) record.fields = Object.fromEntries(selected.split(',').filter(name => name in record.fields).map(name => [name, record.fields[name]]));
      return response(record);
    }
    if (path.endsWith('/items')) {
      assert.ok(path.includes('/target/'), 'never scan source');
      if (query.has('$filter')) return response({ value: [structuredClone(target)] });
      if (pageMode === 'empty') return response({ value: [] });
      if (query.has('$skiptoken')) return response({ value: [structuredClone(target)] });
      return response({ value: [{ id: '3', eTag: '"1"', fields: { ...target.fields, Title: 'Other employee', STATUS: 'INATIVO', IDFORNECEDORORIGEM: '18' } }],
        '@odata.nextLink': parsed.origin + '/v1.0/sites/site/lists/target/items?$expand=fields&$skiptoken=second' });
    }
    if (path.endsWith('/lists')) return response({ value: [{ id: 'target', displayName: 'FUNCIONARIOSRH', list: { template: 'genericList' } }, { id: 'source', displayName: 'FORNECEDORES', list: { template: 'genericList' } }] });
    return response({ id: 'site' });
  };
  const context = { accountKey, siteIdentity, storage, assertSession() { if (!alive) throw new Error('Synthetic session ended'); } };
  const repository = createSharePointRepository(createGraphClient(async scopes => { context.assertSession(); tokens.push(scopes); return 'synthetic-token'; }, { fetch: fetchImpl }),
    { personal: { host: 'synthetic.sharepoint.com', path: '/sites/rh', readTransport: 'graph', writeTransport: 'graph' } },
    { getLifecycleContext: () => context });
  return { source, target, repository, context, fetchImpl, storage, calls, writes, tokens,
    failTarget: mode => { targetFailure = mode; }, failSource: mode => { sourceFailure = mode; }, close: () => { alive = false; }, empty: () => { pageMode = 'empty'; } };
}
