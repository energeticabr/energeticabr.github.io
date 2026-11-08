import test from 'node:test';
import assert from 'node:assert/strict';
import { createNfeOrderLink } from '../src/chat/nfe-order-link.js';
import { rankNfeOrderOptions } from '../src/chat/nfe-report-model.js';

const order = (id, supplier, amount) => ({ id, fields:{ FORNECEDOR:supplier, VALORTOTAL:amount } });

test('ranks orders by similar total or legal name and marks combined matches first', () => {
  const ranked = rankNfeOrderOptions([
    { id:'1', supplier:'Outro fornecedor', amount:'1.550,00' },
    { id:'2', supplier:'Concretizar', amount:'3.800,00' },
    { id:'3', supplier:'CONCRETIZAR CONCRETOS', amount:'1.490,00' },
    { id:'4', supplier:'OUTRA COMERCIAL LTDA', amount:'3.000,00' },
    { id:'5', supplier:'Outro fornecedor', amount:'1.501,00' },
  ], { supplier:'Concretizár Concretos Comercial Ltda.', total:1500 });
  assert.deepEqual(ranked.map(item => [item.id, item.recommended]), [
    ['3',true], ['5',true], ['1',true], ['2',true], ['4',false],
  ]);
  assert.match(ranked[0].matchDetail, /valor.*razão social/i);
  assert.equal(rankNfeOrderOptions([{ id:'1', supplier:'', amount:0 }], { total:null })[0].recommended, false);
  const exactName = rankNfeOrderOptions([{ id:'1', supplier:'Construções e Serviços Ltda.' }],
    { supplier:'CONSTRUCOES E SERVICOS LTDA' });
  assert.equal(exactName[0].recommended, true);
});

test('reads PEDIDOS and writes only the selected ID to an unlinked note with its version', async () => {
  const rows = [order('37', 'Elétrica Teste Ltda', '1.500,00')];
  const writes = [];
  let linked = null;
  const repository = {
    async resolveList(site, aliases) {
      assert.deepEqual(aliases, [site === 'company' ? 'NOTAS_FISCAIS_SEFAZ' : 'NOTASPENDENTES']);
      return { status:'resolved', id:site };
    },
    async getItems(site, list) { assert.deepEqual([site,list], ['personal','personal']); return rows; },
    async getItem(site, list, id) {
      assert.equal(list, site);
      return site === 'personal' ? rows.find(row => row.id === id) :
        { id, eTag:'"v1"', fields:{ IDPEDIDO:linked } };
    },
    async updateItem(site, list, id, fields, options) {
      writes.push([site,list,id,fields,options.eTag]);
      linked = fields.IDPEDIDO;
      return { id, fields:{ IDPEDIDO:linked } };
    },
  };
  const service = createNfeOrderLink({ repository });
  const options = await service.loadOptions();
  assert.deepEqual(options.map(({id,supplier,amount}) => ({id,supplier,amount})), [
    { id:'37', supplier:'Elétrica Teste Ltda', amount:'1.500,00' },
  ]);
  assert.equal(writes.length, 0);
  await assert.rejects(service.save({ invoiceId:'10', orderId:'38' }), /pedido/i);
  assert.deepEqual(await service.save({ invoiceId:'10', orderId:'37' }), { invoiceId:'10', orderId:'37' });
  await service.save({ invoiceId:'10', orderId:'37' });
  rows.push(order('38','Outro',500));
  await assert.rejects(service.save({ invoiceId:'10', orderId:'38' }), /já está vinculada/i);
  assert.deepEqual(writes, [['company','company','10',{ IDPEDIDO:37 },'"v1"']]);
});


test('fiscal gallery adapter pages Graph orders and uses scoped REST versioned read, MERGE and readback', async () => {
  const { createRegistrationGalleryData } = await import('../src/chat/registration-gallery-data.js');
  const company = 'https://tenant.sharepoint.com';
  const personal = 'tenant-my.sharepoint.com';
  const notes = '11111111-2222-3333-4444-555555555555';
  const orders = '22222222-3333-4444-5555-666666666666';
  const orderUrl = `https://graph.microsoft.com/v1.0/sites/personal/lists/${orders}/items`;
  const scopes = [], writes = [];
  let linked = null, withVersion = false;
  const json = value => Response.json(value);
  const data = createRegistrationGalleryData({ kind:'notas_fiscais_sefaz',
    siteConfig:{ company:{ host:'tenant.sharepoint.com', path:'/sites/company', writeTransport:'graph' },
      personal:{ host:personal, path:'/personal/user', readTransport:'graph' } },
    tokenProvider:async requested => { scopes.push(...requested); return 'fictitious-token'; },
    fetchImpl:async (url, options) => {
      const target = new URL(url);
      if (target.href.includes(`/sites/${personal}:`)) return json({ id:'personal' });
      if (target.pathname.endsWith('/sites/personal/lists')) {
        return json({ value:[{ id:orders, displayName:'NOTASPENDENTES', list:{ template:'genericList' } }] });
      }
      if (target.href.startsWith(orderUrl + '?')) {
        if (target.searchParams.has('$skiptoken')) return json({ value:[order('37','Elétrica Teste','1.490,00')] });
        assert.equal(target.searchParams.get('$expand'), 'fields($select=FORNECEDOR,VALORTOTAL,FILIAL)');
        return json({ value:[order('38','Outro',500)], '@odata.nextLink':orderUrl + '?$skiptoken=next' });
      }
      if (target.href.startsWith(orderUrl + '/37?')) return json({ id:'37' });
      assert.equal(target.origin, company);
      if (target.pathname.endsWith('/_api/web/lists')) {
        return json({ value:[{ Id:notes, Title:'NOTAS_FISCAIS_SEFAZ', BaseTemplate:100, Hidden:false }] });
      }
      assert.ok(decodeURIComponent(target.pathname).endsWith(`lists(guid'${notes}')/items(10)`), target.href);
      if (options.method === 'POST') {
        writes.push(JSON.parse(options.body));
        assert.equal(options.headers['X-HTTP-Method'], 'MERGE');
        assert.equal(options.headers['IF-MATCH'], '"5"');
        linked = writes.at(-1).IDPEDIDO;
        return new Response(null, { status:204 });
      }
      assert.equal(target.searchParams.get('$select'), 'ID,IDPEDIDO');
      withVersion = options.headers.Accept.endsWith('minimalmetadata');
      return json({ ID:10, IDPEDIDO:linked, ...(withVersion ? { 'odata.etag':'"5"' } : {}) });
    },
  });
  assert.deepEqual((await data.orderLink.loadOptions()).map(item => item.id), ['38','37']);
  assert.ok(scopes.every(scope => scope === 'Sites.Read.All'));
  assert.deepEqual(await data.orderLink.save({ invoiceId:'10', orderId:'37' }), { invoiceId:'10', orderId:'37' });
  assert.deepEqual(writes, [{ IDPEDIDO:37 }]);
  assert.ok(scopes.includes(company + '/AllSites.Write'));
  assert.equal(withVersion, false, 'the final request reads back the stored link');
});
