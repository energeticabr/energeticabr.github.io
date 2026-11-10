import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationGalleryData, REGISTRATION_GALLERY_MODELS } from '../src/chat/registration-gallery-data.js';
import { createSicoobOrderLink, rankSicoobOrderOptions, sicoobOrderId } from '../src/chat/sicoob-order-link.js';

test('suggestions rank exact positive cents before names alone and preserve all options', () => {
  const candidates = [
    { id:'1', supplier:'Ágata Comércio', amount:'1.501,00' },
    { id:'2', supplier:'Outra pessoa', amount:'R$ 1.500,00' },
    { id:'3', supplier:'Ágata', amount:1500 },
    { id:'4', supplier:'Não relacionado', amount:'1.499,99' },
    { id:'5', supplier:'Outra pessoa', amount:'1500.00' },
  ];
  const ranked = rankSicoobOrderOptions(candidates, { supplier:'AGATA COMERCIAL LTDA', amount:1500 });
  assert.deepEqual(ranked.map(({id, recommended}) => [id,recommended]), [
    ['3',true], ['5',true], ['2',true], ['1',true], ['4',false],
  ]);
  assert.match(ranked[0].matchDetail, /valor igual.*nome\/razão social semelhante/i);
  assert.equal(ranked[1].matchDetail, 'Valor igual');
  assert.equal(ranked[3].matchDetail, 'Nome/razão social semelhante');
  assert.equal(ranked[4].matchDetail, '');
  assert.deepEqual(candidates.map(({id}) => id), ['1','2','3','4','5']);
});

test('blank, zero, negative, malformed money and unknown names never create suggestions', () => {
  for (const amount of [null, '', 0, '0,00', -12, 'nulo', '1.2,00', true, ['12'], '1 2', Infinity]) {
    assert.equal(rankSicoobOrderOptions([{ id:'1', amount }], { amount })[0].recommended, false, String(amount));
  }
  for (const supplier of ['', 'N/A', 'Identificação pendente', 'Não informado', 'Fornecedor não informado',
    'Recebedor não identificado', 'Sem identificação', 'Desconhecido', 'Empresa Comercial Ltda.']) {
    assert.equal(rankSicoobOrderOptions([{ id:'1', supplier }], { supplier })[0].recommended, false, supplier);
  }
  assert.equal(rankSicoobOrderOptions([{ id:'1', supplier:'N/A', amount:100 }], { supplier:'N/A', amount:100 })[0].recommended, true);
});

test('only valid SharePoint integer IDs can be linked', () => {
  assert.equal(sicoobOrderId(37), '37');
  assert.equal(sicoobOrderId(' 37 '), '37');
  for (const id of [0, null, -1, 1.2, '012', '1e4', '9007199254740992', [37]]) assert.equal(sicoobOrderId(id), '');
});

test('payment link loads all personal SharePoint order pages then writes only IDPEDIDO with a REST ETag and readback', async () => {
  const host = 'tenant-my.sharepoint.com';
  const payments = '11111111-2222-3333-4444-555555555555';
  const orders = '22222222-3333-4444-5555-666666666666';
  const orderUrl = `https://graph.microsoft.com/v1.0/sites/personal/lists/${orders}/items`;
  const movementPath = `/_api/web/lists(guid'${payments}')/items(10)`;
  const scopes = [], writes = [];
  let linked = null, versioned = false, readbacks = 0, mergeStatus = 204, actualReadback, invalidPage = false;
  const json = value => Response.json(value);
  const data = createRegistrationGalleryData({ kind:'financial_movement',
    siteConfig:{ personal:{ host, path:'/personal/user', readTransport:'graph', writeTransport:'graph' } },
    tokenProvider:async requested => { scopes.push(...requested); return 'fictitious-token'; },
    fetchImpl:async (url, options) => {
      const target = new URL(url);
      if (target.href.includes(`/sites/${host}:`)) return json({ id:'personal' });
      if (target.pathname.endsWith('/sites/personal/lists')) return json({ value:[
        { id:orders, displayName:'NOTASPENDENTES', list:{ template:'genericList' } },
      ] });
      if (target.href.startsWith(orderUrl + '?')) {
        if (target.searchParams.has('$skiptoken')) return json(invalidPage ? { error:'incomplete' } :
          { value:[{ id:'37', fields:{ FORNECEDOR:'Elétrica Teste', VALORTOTAL:'1.490,00', FILIAL:'OBRA A' } }] });
        assert.equal(target.searchParams.get('$expand'), 'fields($select=FORNECEDOR,VALORTOTAL,FILIAL)');
        return json({ value:[{ id:'38', fields:{ FORNECEDOR:'Outro', VALORTOTAL:500 } }],
          '@odata.nextLink':orderUrl + '?$skiptoken=next' });
      }
      if (target.href.startsWith(orderUrl + '/37?')) {
        assert.equal(target.searchParams.get('$expand'), 'fields($select=FORNECEDOR)');
        return json({ id:'37', fields:{ FORNECEDOR:' Elétrica Teste ' } });
      }
      if (target.href.startsWith(orderUrl + '/38?')) return json({ id:'38' });
      if (target.href.startsWith(orderUrl + '/39?')) return new Response(null, { status:404 });
      if (target.href.startsWith(orderUrl + '/40?')) return new Response(null, { status:403 });
      assert.equal(target.origin, `https://${host}`);
      const pathname = decodeURIComponent(target.pathname).replace('/personal/user','');
      if (pathname === '/_api/web/lists') return json({ value:[
        { Id:payments, Title:'MOVIMENTACOESFINANCEIRAS', BaseTemplate:100, Hidden:false },
      ] });
      assert.equal(pathname, movementPath);
      if (options.method === 'POST') {
        writes.push(JSON.parse(options.body));
        assert.equal(options.headers['X-HTTP-Method'], 'MERGE');
        assert.equal(options.headers['IF-MATCH'], '"5"');
        if (mergeStatus !== 204) return Response.json({ error:{ message:'Version conflict' } }, { status:mergeStatus });
        linked = writes.at(-1).IDPEDIDO;
        return new Response(null, { status:204 });
      }
      versioned = options.headers.Accept.endsWith('minimalmetadata');
      assert.equal(target.searchParams.get('$select'), versioned ? 'ID,IDPEDIDO,ORIGEMMOVIMENTACAO' : 'ID,IDPEDIDO');
      if (!versioned) readbacks++;
      return json({ ID:10, IDPEDIDO:versioned ? linked : actualReadback ?? linked,
        ...(versioned ? { ORIGEMMOVIMENTACAO:'SICOOB', 'odata.etag':'"5"' } : {}) });
    },
  });
  assert.equal(typeof data.orderLink?.loadOptions, 'function');
  assert.deepEqual(await data.orderLink.loadOptions(), [
    { id:'38', supplier:'Outro', amount:500, label:'#38 · Outro' },
    { id:'37', supplier:'Elétrica Teste', amount:'1.490,00', label:'#37 · Elétrica Teste · OBRA A' },
  ]);
  assert.ok(scopes.every(scope => scope === 'Sites.Read.All'));
  assert.deepEqual(await data.orderLink.loadSuppliers(['37', '37', '38', '39', '40']),
    { suppliers: new Map([['37', 'Elétrica Teste']]), incomplete:true });
  invalidPage = true;
  await assert.rejects(data.orderLink.loadOptions(), { code:'graph_pagination_payload_invalid' });
  await assert.rejects(data.orderLink.save({ movementId:10, orderId:39 }), /pedido.*indisponível/i);
  assert.equal(writes.length, 0);
  assert.deepEqual(await data.orderLink.save({ movementId:10, orderId:37 }),
    { movementId:'10', orderId:'37', supplier:'Elétrica Teste' });
  assert.deepEqual(writes, [{ IDPEDIDO:37 }]);
  assert.ok(scopes.includes(`https://${host}/AllSites.Write`));
  assert.equal(readbacks, 1);
  await data.orderLink.save({ movementId:10, orderId:37 });
  await assert.rejects(data.orderLink.save({ movementId:10, orderId:38, expectedOrderId:36 }), /vínculo.*mudou/i);
  assert.equal(writes.length, 1);
  mergeStatus = 412;
  await assert.rejects(data.orderLink.save({ movementId:10, orderId:38, expectedOrderId:37 }), { code:'concurrent_change' });
  assert.equal(readbacks, 1);
  mergeStatus = 204;
  actualReadback = 37;
  await assert.rejects(data.orderLink.save({ movementId:10, orderId:38, expectedOrderId:37 }), /não foi confirmado/i);
});

test('invalid catalog, nonbank movement, missing order or ETag, and cancelled sessions do not write', async () => {
  let orders, writes = 0, reads = 0, target = { id:'37' }, live = true, cancelDuringRead;
  const movement = { id:'10', eTag:'"1"', fields:{ ORIGEMMOVIMENTACAO:'SICOOB', IDPEDIDO:null } };
  const service = createSicoobOrderLink({
    repository:{
      async resolveList(site, [name]) { assert.equal(site, 'personal'); return { status:'resolved', id:name }; },
      async getItems() { return orders; },
      async getItem(_site, list) {
        reads++;
        cancelDuringRead?.abort();
        return list === 'NOTASPENDENTES' ? target : movement;
      },
      async updateItem() { writes++; },
    },
    assertSession() { if (!live) throw new Error('Sessão encerrada'); },
  });
  await assert.rejects(service.loadOptions(), /incompleta/i);
  orders = [{ id:'37', fields:{} }, { id:'37', fields:{} }];
  await assert.rejects(service.loadOptions(), /pedido inválido/i);
  orders = [{ id:'37', fields:{ FORNECEDOR:['fornecedor'] } }];
  await assert.rejects(service.loadOptions(), /pedido inválido/i);
  const selection = { movementId:10, orderId:37 };
  target = null;
  await assert.rejects(service.save(selection), /pedido.*indisponível/i);
  target = { id:'37' };
  movement.fields.ORIGEMMOVIMENTACAO = 'MANUAL';
  await assert.rejects(service.save(selection), /sicoob/i);
  movement.fields.ORIGEMMOVIMENTACAO = 'SICOOB';
  movement.eTag = '*';
  await assert.rejects(service.save(selection), /versão/i);
  movement.eTag = '"1"';
  cancelDuringRead = new AbortController();
  await assert.rejects(service.save({ ...selection, signal:cancelDuringRead.signal }), { name:'AbortError' });
  const priorReads = reads;
  await assert.rejects(service.save({ ...selection, signal:cancelDuringRead.signal }), { name:'AbortError' });
  assert.equal(reads, priorReads);
  live = false;
  await assert.rejects(service.save(selection), /sessão encerrada/i);
  assert.equal(writes, 0);
});

test('the movement model exposes the linked order without allowing generic edits', () => {
  const model = REGISTRATION_GALLERY_MODELS.financial_movement;
  assert.ok(model.fields.includes('IDPEDIDO'));
  assert.ok(model.fieldLabels.IDPEDIDO);
  assert.ok(!model.metadataEditorFields.includes('IDPEDIDO'));
});

