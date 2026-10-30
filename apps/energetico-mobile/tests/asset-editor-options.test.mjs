import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';

const catalogs = [
  ['FUN_x00c7__x00c3_O', 'FUNCAOIMOBILIZADO', 'FUNCAO'],
  ['FORNECEDOR', 'FORNECEDORES', 'CADASTRO'],
  ['GRUPOIMOBILIZADO', 'GRUPO IMOBILIZADOS', 'GRUPOIMOBILIZADOS'],
  ['ITEM', 'CADASTROIMOBILIZADO', 'IMOBILIZADO'],
  ['FILIAL', 'FILIAIS', 'FILIAL'],
];

function fixture() {
  const calls = [], writes = [];
  const fields = Object.fromEntries(catalogs.map(([field]) => [field, 'ATUAL']));
  Object.assign(fields, { STATUS: 'ATIVO', CONDI_x00c7__x00c3_O: 'APLICADO EM OBRA', DEPRECIAR: 'SIM' });
  const lists = ['IMOBILIZADOS', ...catalogs.map(([,list]) => list)].map((displayName, index) => ({
    id: `list-${index}`, displayName, list: { template: 'genericList' },
  }));
  const graph = { async request(path, options = {}) {
    calls.push({ path, options });
    const url = new URL(path, 'https://graph.microsoft.com/v1.0/');
    const list = lists.find(list => url.pathname.includes(`/lists/${list.id}/`));
    if (options.method === 'PATCH') { writes.push({ path, options }); return {}; }
    if (url.pathname.endsWith('/columns')) {
      if (list.id === 'list-0') return { value: Object.keys(fields).map(name => ({ name, text: {} })) };
      const [, , valueField] = catalogs.find(([,name]) => name === list.displayName);
      return { value: ['FILIAL','CADASTRO'].includes(valueField)
        ? [{ name:'Title', displayName:valueField, indexed:true, text:{} },
          { name:'LinkTitle', displayName:valueField, readOnly:true, computed:true }]
        : [valueField,'Title'].map(name => ({ name, indexed:true, text:{} })) };
    }
    if (url.pathname.endsWith('/items/42')) return { id: '42', eTag: '"v1"', fields };
    if (url.pathname.endsWith('/items')) {
      const [, , valueField] = catalogs.find(([,name]) => name === list.displayName);
      const filter = url.searchParams.get('$filter') || '';
      // Empty-prefix SharePoint queries must never stand in for browsing a catalog.
      if (/startswith\([^,]+,''\)/.test(filter)) return { value: [] };
      const internalField = ['FILIAL','CADASTRO'].includes(valueField) ? 'Title' : valueField;
      const rows = Array.from({ length: 25 }, (_,i) => ({ id:String(i+1), fields: {
        Title:null, [internalField]: `OPÇÃO ${String(i+1).padStart(2,'0')}`,
      } }));
      const term = /startswith\([^,]+,'([^']+)'\)/.exec(filter)?.[1];
      if (term) return { value: rows.filter(row => row.fields[internalField].startsWith(term)) };
      if (url.searchParams.has('$skiptoken')) return { value: rows.slice(20) };
      return { value: rows.slice(0,20), '@odata.nextLink': `https://graph.microsoft.com/v1.0/sites/test-site/lists/${list.id}/items?$skiptoken=page2` };
    }
    if (url.pathname.endsWith('/lists')) return { value: lists };
    return { id: 'test-site' };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: 'tenant.sharepoint.com', path: '/sites/test' } });
  const data = createRegistrationGalleryData({ kind:'asset', repository });
  return { data, calls, writes };
}

for (const [field] of catalogs) {
  test(`asset editor browses all alternatives and filters ${field} from an empty search`, async () => {
    const f = fixture(), context = await f.data.loadEditor('42');
    const column = context.columns.find(column => column.name === field);
    const source = column.powerApps.optionSources[0];
    const options = await context.powerAppsOptionSearch(column, source, '', {}, { browse:true, limit:20 });
    assert.equal(options.length,25);
    assert.equal(options.at(-1).value,'OPÇÃO 25');
    const first = f.calls.find(call => call.path.includes('/items?'));
    assert.equal(new URL(first.path,'https://graph.microsoft.com').searchParams.has('$filter'),false);
    const filtered = await context.powerAppsOptionSearch(column,source,'OPÇÃO 25',{}, {limit:20});
    assert.deepEqual(filtered.map(option => option.value),['OPÇÃO 25']);
    await f.data.saveEditor(context,{[field]:'OPÇÃO 25'});
    assert.equal(f.writes.length,1);
    assert.deepEqual(f.writes[0].options.body,{[field]:'OPÇÃO 25'});
    assert.equal(f.writes[0].options.headers['If-Match'],'"v1"');
  });
}

test('asset editor offers every literal dropdown alternative', async () => {
  const f = fixture(), context = await f.data.loadEditor('42');
  for (const [field, expected] of [
    ['STATUS',['ATIVO','INATIVO']],
    ['CONDI_x00c7__x00c3_O',['APLICADO EM OBRA','OCIOSO EM SEDE','IRRECUPERÁVEL','EXTRAVIADO']],
    ['DEPRECIAR',['SIM','NÃO']],
  ]) assert.deepEqual(context.columns.find(column => column.name === field).choices,expected);
  await f.data.saveEditor(context,{STATUS:'INATIVO',CONDI_x00c7__x00c3_O:'OCIOSO EM SEDE',DEPRECIAR:'NÃO'});
  assert.equal(f.writes.length,1);
});
