import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNfeProposalData } from '../src/chat/nfe-proposal-data.js';
import { nfeLearningIssuerHash } from '../src/chat/nfe-proposal-learning.js';

const key = '35261112345678000123550010000000011000000011';
const row = { id:'7', key, type:'NF-e', number:'1', date:'2026-11-09', complete:true,
  supplier:'Fornecedor teste', taxId:'12.345.678/0001-23', pdfName:'nota.pdf', xmlUrl:'https://company.example/sites/finance/nota.xml' };
const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${key}">
  <ide><dhEmi>2026-11-09T12:00:00-03:00</dhEmi></ide>
  <det nItem="1"><prod><cProd>ET-2</cProd><xProd>Descrição do fornecedor</xProd><uCom>UN</uCom>
    <qCom>2</qCom><vUnCom>37.50</vUnCom><vProd>75</vProd><indTot>1</indTot></prod></det>
  <total><ICMSTot><vProd>75</vProd><vNF>75</vNF></ICMSTot></total>
</infNFe></NFe>`;
const item = (id, fields) => ({ id, fields });
const catalogs = {
  FORNECEDORES:[item('11',{ Title:row.supplier,DOCUMENTOFORNECEDOR:row.taxId,FILIAL:'Obra A',FORMAPGTO:'Conta A' })],
  FILIAIS:[item('12',{ Title:'Obra A' })],
  CADASTROPRODUTO:[item('13',{ field_1:'Produto interno',UNIDADE:'UN',TIPODESPESA:'MATERIAL' })],
  LANCAMENTOOBRA:[item('14',{ field_3:'Estrutura',FILIAL:'Obra A' }),item('15',{ field_3:'Fundação',FILIAL:'Obra A' })],
  CADASTROCONTA:[item('16',{ Title:'Conta A' })],
  LANCAMENTOS:[],
};

test('a later fiscal proposal uses confirmed corrections from the same account and supplier', async t => {
  const dom = new JSDOM();
  t.after(() => dom.window.close());
  const issuer = await nfeLearningIssuerHash(row);
  const scopeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['account-a.tenant',issuer])));
  const scope = Array.from(new Uint8Array(scopeBytes), byte => byte.toString(16).padStart(2,'0')).join('');
  const example = { version:1, issuer, at:100, lines:[{ code:'et-2',description:'descricao do fornecedor',unit:'un',
    productId:'13',stageId:'15',branchId:'12',changed:['productId','stageId'] }] };
  let reads = 0, attemptedReservation;
  const repository = {
    resolveList:async (_site, [name]) => ({ status:'resolved',id:name }),
    getItem:async (site, list, id) => {
      assert.deepEqual([site,list,id], ['company','NOTAS_FISCAIS_SEFAZ',row.id]);
      return { id, eTag:'"1"', fields:{ CHAVE_ACESSO:key,TIPO_FISCAL:'NF-e',DIRECAO:'ENTRADA',
        STATUS_IMPORTACAO:'XML_COMPLETO',SITUACAO:'AUTORIZADA',STATUS_DANFE:'DISPONIVEL',
        DANFE_URL:{ Url:'https://company.example/sites/finance/nota.pdf' }, XML_URL:{ Url:row.xmlUrl },NUMERO_NOTA:row.number } };
    },
    getColumns:async (_site, list) => [{
      name:list === 'NOTASPENDENTES' ? 'NFEORIGEM' : 'NFELINHA', text:{ allowMultipleLines:false },
      readOnly:false, required:false, indexed:true, enforceUniqueValues:true,
    }],
    updateItem:async (site, list, id, fields) => {
      assert.deepEqual([site,list,id], ['company','NOTAS_FISCAIS_SEFAZ',row.id]);
      attemptedReservation = JSON.parse(fields.NFEPROPOSTA);
      throw new Error('stopped before financial writes');
    },
    getItems:async (site, list, query) => {
      if (site === 'personal') return catalogs[list];
      reads++;
      const params = new URLSearchParams(query);
      assert.equal(list,'NOTAS_FISCAIS_SEFAZ');
      assert.equal(params.get('$select'),'IDPEDIDO,NFEAPRENDIZADO,NFEAPRENDIZCHAVE');
      const filtered = params.get('$filter');
      assert.match(filtered,/^NFEAPRENDIZCHAVE eq '[a-f0-9]{64}'$/);
      // Include a leaked wrong-scope row to exercise the defensive client check.
      return [item('3',{ IDPEDIDO:19,NFEAPRENDIZADO:JSON.stringify(example),NFEAPRENDIZCHAVE:scope }),
        item('4',{ IDPEDIDO:null,NFEAPRENDIZADO:JSON.stringify({ ...example, at:200 }),NFEAPRENDIZCHAVE:scope })];
    },
  };
  const data = accountKey => createNfeProposalData({ repository, fiscalData:{
    downloadDocument:async () => new Blob([xml]),
    listAttachments:async () => [{ fileName:row.pdfName }],
    downloadAttachment:async () => new Blob(['%PDF-1.7\nexemplo\n%%EOF\n'], { type:'application/pdf' }),
  }, accountKey, userEmail:'fiscal@example.test', DOMParser:dom.window.DOMParser });
  const service = data('Account-A.Tenant');
  const learned = await service.load(row);
  assert.deepEqual([learned.draft.lines[0].productId,learned.draft.lines[0].stageId], ['13','15']);
  assert.deepEqual([learned.draft.lines[0].quantity,learned.draft.lines[0].unitPrice,learned.draft.lines[0].date], ['2','37.5',row.date]);
  learned.draft.lines[0].stageId = '14';
  assert.equal(learned.baseline.lines[0].stageId,'15');
  await assert.rejects(service.submit(row, learned.draft, { ...learned, manualStages:new Set(['1']) }), /stopped before financial writes/);
  assert.equal(attemptedReservation.learning.scope, scope);
  const recorded = JSON.parse(attemptedReservation.learning.data);
  assert.deepEqual(recorded.lines.map(line => [line.productId,line.stageId,line.changed]), [['13','14',['stageId']]]);
  const otherAccount = await data('account-b.tenant').load(row);
  assert.equal(otherAccount.draft.lines[0].productId,'');
  assert.equal(reads,2);
});

test('posting a manually completed note trains the next note even if history was unavailable on the first read', async t => {
  const dom = new JSDOM();
  t.after(() => dom.window.close());
  const next = { ...row, id:'8', number:'2', key:key.slice(0,-1)+'2', date:'2026-11-10',
    xmlUrl:row.xmlUrl.replace('nota.xml','nota2.xml') };
  const notes = [row, next].map(note => ({ id:note.id, eTag:'"1"', fields:{
    CHAVE_ACESSO:note.key,TIPO_FISCAL:note.type,DIRECAO:'ENTRADA',NUMERO_NOTA:note.number,
    STATUS_IMPORTACAO:'XML_COMPLETO',SITUACAO:'AUTORIZADA',STATUS_DANFE:'DISPONIVEL',
    DANFE_URL:{ Url:'https://company.example/sites/finance/nota.pdf' }, XML_URL:{ Url:note.xmlUrl },
  } }));
  const choices = { ...catalogs, FORNECEDORES:[item('11',{ Title:'Cadastro ZZ',FILIAL:'Obra A',FORMAPGTO:'Conta A' })] };
  const orders = [], launches = [], attachments = new Map();
  const table = list => list === 'NOTAS_FISCAIS_SEFAZ' ? notes : list === 'NOTASPENDENTES' ? orders : launches;
  let historyUnavailable = true;
  const repository = {
    resolveList:async (_site, [name]) => ({ status:'resolved', id:name }),
    getColumns:async (_site, list) => [{
      name:list === 'NOTASPENDENTES' ? 'NFEORIGEM' : 'NFELINHA', text:{ allowMultipleLines:false },
      readOnly:false, required:false, indexed:true, enforceUniqueValues:true,
    }],
    async getItems(site, list, query) {
      if (site === 'company') {
        if (historyUnavailable) throw new Error('Temporary history outage');
        const scope = query.match(/NFEAPRENDIZCHAVE eq '([a-f0-9]{64})'/)?.[1];
        return structuredClone(notes.filter(note => note.fields.NFEAPRENDIZCHAVE === scope));
      }
      const match = decodeURIComponent(query).match(/fields\/(NFEORIGEM|NFELINHA) eq '([A-Z0-9-]+)'/);
      if (match) return structuredClone(table(list).filter(record => record.fields[match[1]] === match[2]));
      return choices[list];
    },
    async getItem(_site, list, id) { return structuredClone(table(list).find(record => record.id === id)); },
    async updateItem(_site, list, id, fields, { eTag }) {
      const record = table(list).find(record => record.id === id);
      assert.equal(eTag, record.eTag);
      Object.assign(record.fields, fields);
      record.eTag = `"${Number(record.eTag.slice(1,-1))+1}"`;
      return structuredClone(record);
    },
    async createItem(_site, list, fields) {
      const records = table(list);
      const id = String(40 + records.length);
      records.push({ id, eTag:'"1"', fields:structuredClone(fields) });
      return { id };
    },
    async listAttachments(_site, _list, id) {
      return attachments.has(id) ? [{ fileName:row.pdfName }] : [];
    },
    async uploadAttachment(_site, _list, id, pdf) { attachments.set(id, pdf); },
    async downloadAttachment(_site, _list, id) { return attachments.get(id); },
  };
  const service = () => createNfeProposalData({ repository, accountKey:'account-a.tenant',
    DOMParser:dom.window.DOMParser, fiscalData:{
      downloadDocument:async url => new Blob([url === row.xmlUrl ? xml : xml.replace(key,next.key)
        .replace(row.date,next.date).replace('<qCom>2</qCom>','<qCom>4</qCom>').replaceAll('>75<','>150<')]),
      listAttachments:async () => [{ fileName:row.pdfName }],
      downloadAttachment:async () => new Blob(['%PDF-1.7\nexemplo\n%%EOF\n'], { type:'application/pdf' }),
    },
  });
  const first = service();
  const reviewed = await first.load(row);
  assert.deepEqual([reviewed.draft.supplierId, reviewed.draft.lines[0].productId, reviewed.draft.lines[0].stageId], ['', '', '']);
  Object.assign(reviewed.draft, { supplierId:'11', branchId:'12', accountId:'16' });
  Object.assign(reviewed.draft.lines[0], { productId:'13', stageId:'15' });
  const receipt = await first.submit(row, reviewed.draft, { ...reviewed, manualStages:new Set(['1']) });
  assert.equal(receipt.orderId, '40');
  assert.equal(notes[0].fields.IDPEDIDO, 40);
  assert.ok(notes[0].fields.NFEAPRENDIZADO, 'successful fiscal link persists the reviewed choices');

  historyUnavailable = false;
  const reopened = service();
  const later = await reopened.load(next);
  assert.deepEqual([later.draft.supplierId, later.draft.branchId, later.draft.accountId], ['11','12','16']);
  const { productId, stageId, quantity, date } = later.draft.lines[0];
  assert.deepEqual([productId, stageId, quantity, date], ['13','15','4',next.date]);
  assert.equal(orders.length, 1, 'opening a suggestion never submits a new order');
  await reopened.submit(next, later.draft, { ...later, manualStages:new Set() });
  const confirmation = JSON.parse(notes[1].fields.NFEAPRENDIZADO);
  assert.deepEqual(confirmation.headerChanged, []);
  assert.deepEqual(confirmation.lines.map(line => [line.productId,line.stageId,line.changed]), [['13','15',[]]]);
});
