import assert from 'node:assert/strict';
import test from 'node:test';
import { createNfeProposalPosting } from '../src/chat/nfe-proposal-posting.js';

const key = '35261112345678000123550010000000011000000011';
const pdfName = `DANFE-${key}-0123456789abcdef.pdf`;
const xmlUrl = 'https://company.example/sites/finance/Documentos/xml-original.xml';
const invoice = { id:'7', key, pdfName, type:'NF-e', xmlUrl, number:'1' };
const pdf = new Blob(['%PDF-1.7\noriginal\n%%EOF\n'], { type:'application/pdf' });
const wrongPdf = new Blob(['%PDF-1.7\ndifferent\n%%EOF\n'], { type:'application/pdf' });
const draft = { lines:[{ number:1, account:'A' }, { number:2, account:'B' }] };
const expected = { invoiceId:'7', orderId:'40', launchIds:['50','51'] };

function fixture() {
  const fiscal = { IDPEDIDO:null, NFEPROPOSTA:null, CHAVE_ACESSO:key, TIPO_FISCAL:'NF-e', DIRECAO:'ENTRADA',
    STATUS_IMPORTACAO:'XML_COMPLETO', SITUACAO:'AUTORIZADA', STATUS_DANFE:'DISPONIVEL',
    DANFE_URL:{ Url:`https://company.example/sites/finance/Lists/Notas/Attachments/7/${pdfName}` },
    XML_URL:{ Url:xmlUrl }, NUMERO_NOTA:'1' };
  const tables = { NOTASPENDENTES:[], LANCAMENTOS:[] };
  const files = new Map();
  const events = [];
  const state = { revision:1, orderRevision:1, sourcePdf:pdf };
  function fiscalItem() { return { id:'7', eTag:`\"${state.revision}\"`, fields:structuredClone(fiscal) }; }
  const repository = {
    async resolveList(site, [name]) {
      assert.equal(site, name === 'NOTAS_FISCAIS_SEFAZ' ? 'company' : 'personal');
      return { status:'resolved', id:name };
    },
    async getColumns(site, list, options) {
      assert.equal(site, 'personal');
      assert.equal(options.includeHidden, true);
      const name = list === 'NOTASPENDENTES' ? 'NFEORIGEM' : 'NFELINHA';
      return [{ name, text:{ allowMultipleLines:false }, readOnly:false, required:false,
        indexed:true, enforceUniqueValues:state.withoutUniqueConstraint !== name }];
    },
    async getItem(site, list, id) {
      if (list === 'NOTAS_FISCAIS_SEFAZ') return fiscalItem();
      assert.equal(site, 'personal');
      const item = structuredClone(tables[list].find(item => item.id === id));
      if (item && list === 'NOTASPENDENTES') item.eTag = `\"${state.orderRevision}\"`;
      if (item && state.normalizeFinancialReadback) state.normalizeFinancialReadback(item.fields);
      return item;
    },
    async updateItem(site, list, id, fields, { eTag }) {
      if (site === 'personal') {
        assert.deepEqual([list,id,fields,eTag], ['NOTASPENDENTES','40',{ NOTAFISCAL:'SUBMETIDO' },`\"${state.orderRevision}\"`]);
        assert.equal(tables.NOTASPENDENTES[0].fields.NOTAFISCAL, 'PENDENTE');
        assert.equal(tables.LANCAMENTOS.length, 2);
        if (state.rejectPromotion) throw new Error('promotion unavailable');
        Object.assign(tables.NOTASPENDENTES[0].fields, fields);
        state.orderRevision++;
        events.push('promote');
        if (state.losePromotion) throw new Error('response lost after fiscal promotion');
        return this.getItem(site, list, id);
      }
      assert.equal(site, 'company');
      assert.equal(list, 'NOTAS_FISCAIS_SEFAZ');
      assert.equal(id, '7');
      if (eTag !== `\"${state.revision}\"`) throw new Error('ETag conflict');
      events.push(fields.IDPEDIDO ? 'link' : 'reserve');
      Object.assign(fiscal, fields);
      state.revision++;
      if (fields.IDPEDIDO && state.loseLink) throw new Error('response lost after fiscal update');
      return fiscalItem();
    },
    async getItems(site, list, query) {
      assert.equal(site, 'personal');
      const match = decodeURIComponent(String(query)).match(/fields\/(NFEORIGEM|NFELINHA) eq '([A-Z0-9-]+)'/);
      assert.ok(match, 'a financial retry must search an exact unique key');
      return structuredClone(tables[list].filter(row => row.fields[match[1]] === match[2]));
    },
    async createItem(site, list, fields) {
      assert.equal(site, 'personal');
      assert.ok(fiscal.NFEPROPOSTA, 'financial writes require a durable fiscal reservation');
      const technical = list === 'NOTASPENDENTES' ? 'NFEORIGEM' : 'NFELINHA';
      if (tables[list].some(row => row.fields[technical] === fields[technical])) throw new Error('unique key conflict');
      if (list === 'LANCAMENTOS' && state.rejectLine === fields[technical]) throw new Error('launch creation unavailable');
      const id = String((list === 'NOTASPENDENTES' ? 40 : 50) + tables[list].length);
      tables[list].push({ id, fields:structuredClone(fields) });
      events.push(`${list}:${id}`);
      if (list === 'LANCAMENTOS' && state.changeFiscalAfterLaunch === id) {
        fiscal.XML_URL = { Url:xmlUrl.replace('original', 'corrigido') };
        state.revision++;
      }
      if (list === 'LANCAMENTOS') state.afterLaunch?.({ id, tables, files });
      if (state.loseCreate === fields[technical]) throw new Error('response lost after creation');
      return { id };
    },
    async listAttachments(site, list, id) {
      assert.deepEqual([site,list,id], ['personal','NOTASPENDENTES','40']);
      return [...files.keys()].map(fileName => ({ fileName }));
    },
    async uploadAttachment(site, list, id, file, name) {
      assert.deepEqual([site,list,id,name], ['personal','NOTASPENDENTES','40',pdfName]);
      if (state.rejectAttachment) throw new Error('attachment upload unavailable');
      const bytes = await file.arrayBuffer();
      if (files.has(name)) throw new Error('duplicate file name');
      files.set(name, bytes);
      events.push('attach');
      if (state.loseAttachment) throw new Error('response lost after attachment');
    },
    async downloadAttachment(site, list, id, name) {
      assert.deepEqual([site,list,id], ['personal','NOTASPENDENTES','40']);
      return files.get(name);
    },
  };
  async function prepare(_row, input) {
    if (state.prepareUnavailable) throw new Error('catalog unavailable');
    return { draft:input, orderFields:{ FORNECEDOR:'Fornecedor fictício', VALORTOTAL:15, DATAPEDIDO:'2026-11-08T12:00:00Z',
      STATUS:'PENDENTE AUDITORIA', NOTAFISCAL:'SUBMETIDO' },
      launchFields:input.lines.map(({ number,account }) => ({ number, fields:{ field_14:account, field_8:1, field_2:'2026-11-08T12:00:00Z' } })) };
  }
  const service = () => createNfeProposalPosting({ repository, assertSession:() => {},
    authorizeWrite:async () => { if (state.unauthorized) throw new Error('write consent denied'); },
    prepare, downloadPdf:async () => { state.onDownload?.(); return state.sourcePdf; } });
  return { fiscal, tables, files, events, state, service };
}

test('reserves, creates the order, confirms its PDF, creates both launches and links last', async () => {
  const { fiscal,tables,files,events,service } = fixture();
  assert.deepEqual(await service().submit(invoice,draft), expected);
  assert.deepEqual(events, ['reserve','NOTASPENDENTES:40','attach','LANCAMENTOS:50','LANCAMENTOS:51','promote','link']);
  assert.equal(tables.NOTASPENDENTES[0].fields.NOTAFISCAL, 'SUBMETIDO');
  assert.equal(tables.NOTASPENDENTES[0].fields.STATUS, 'PENDENTE AUDITORIA');
  assert.equal(fiscal.IDPEDIDO, 40);
  assert.equal(fiscal.NFEPROPOSTA, null);
  assert.deepEqual(tables.LANCAMENTOS.map(({ fields }) => [fields.AGRUPAR,fields.field_14]), [['40','A'],['40','B']]);
  assert.deepEqual(files.get(pdfName), await pdf.arrayBuffer());
});

test('reopens a partial attempt with its frozen payload and resumes in a different service instance', async () => {
  const { fiscal,tables,events,state,service } = fixture();
  state.rejectLine = `${key}-2`;
  await assert.rejects(service().submit(invoice,draft), /launch creation unavailable/);
  assert.equal(fiscal.IDPEDIDO, null);
  assert.equal(tables.LANCAMENTOS.length, 1);
  assert.equal(tables.NOTASPENDENTES[0].fields.NOTAFISCAL, 'PENDENTE');
  const stored = JSON.parse(fiscal.NFEPROPOSTA);
  assert.match(stored.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(stored.draft, draft);
  assert.equal('payload' in stored, false);
  assert.deepEqual(await service().loadReservation(invoice), draft);
  const edited = { lines:[{ number:1, account:'C' }, draft.lines[1]] };
  await assert.rejects(service().submit(invoice,edited), /reserva|proposta/i);
  state.rejectLine = null;
  state.prepareUnavailable = true;
  await assert.rejects(service().submit(invoice,draft), /catalog unavailable/);
  assert.equal(tables.LANCAMENTOS.length, 1);
  state.prepareUnavailable = false;
  assert.deepEqual(await service().submit(invoice,draft), expected);
  assert.equal(events.filter(event => event === 'reserve').length, 1);
  assert.equal(tables.NOTASPENDENTES.length, 1);
});

test('recovers lost create, attachment, audit promotion and final link responses without duplicates', async () => {
  const { tables,files,events,state,service } = fixture();
  Object.assign(state, { loseCreate:key, loseAttachment:true, losePromotion:true, loseLink:true });
  assert.deepEqual(await service().submit(invoice,draft), expected);
  assert.deepEqual(await service().submit(invoice,draft), expected);
  assert.equal(tables.NOTASPENDENTES.length, 1);
  assert.equal(tables.LANCAMENTOS.length, 2);
  assert.equal(files.size, 1);
  assert.equal(events.filter(event => event === 'promote').length, 1);
  assert.equal(events.filter(event => event === 'link').length, 1);
});

test('two simultaneous instances share the reservation and create one order and one of each fiscal line', async () => {
  const { tables,files,events,service } = fixture();
  const results = await Promise.all([service().submit(invoice,draft), service().submit(invoice,draft)]);
  assert.deepEqual(results, [expected,expected]);
  assert.equal(tables.NOTASPENDENTES.length, 1);
  assert.equal(tables.LANCAMENTOS.length, 2);
  assert.equal(files.size, 1);
  assert.equal(events.filter(event => event === 'attach').length, 1);
});

test('an existing manual link, unavailable PDF or stale fiscal key cannot create financial records', async () => {
  const scenarios = [
    ({ fiscal }) => { fiscal.IDPEDIDO = 99; },
    ({ fiscal }) => { fiscal.CHAVE_ACESSO = key.replace(/1$/, '2'); },
    ({ fiscal }) => { fiscal.SITUACAO = 'CANCELADA'; },
    ({ fiscal }) => { fiscal.DIRECAO = 'SAÍDA'; },
    ({ fiscal }) => { fiscal.DIRECAO = ''; },
    ({ state }) => { state.sourcePdf = new Blob(['bad PDF']); },
    ({ state }) => { state.unauthorized = true; },
  ];
  for (const configure of scenarios) {
    const setup = fixture();
    configure(setup);
    await assert.rejects(setup.service().submit(invoice,draft));
    assert.deepEqual(setup.events, []);
  }
});

test('requires a positive buyer role for national NFS-e', async () => {
  const { fiscal,events,service } = fixture();
  const serviceInvoice = { ...invoice, key:'1'.repeat(50), type:'NFS-e' };
  Object.assign(fiscal, { CHAVE_ACESSO:serviceInvoice.key, TIPO_FISCAL:'NFS-e', PAPEL_EMPRESA:'' });
  await assert.rejects(service().submit(serviceInvoice,draft), /não está apta/);
  assert.deepEqual(events, []);
});

test('blocks a same-key XML correction or changed number before reserving a stale preview', async () => {
  for (const change of [{ XML_URL:{ Url:xmlUrl.replace('original', 'corrigido') } }, { NUMERO_NOTA:'2' }]) {
    const { fiscal,events,service } = fixture();
    Object.assign(fiscal, change);
    await assert.rejects(service().loadReservation(invoice), /XML|número/i);
    await assert.rejects(service().submit(invoice,draft), /XML|número/i);
    assert.deepEqual(events, []);
  }
});

test('a same-key XML correction during financial work blocks promotion and final link', async () => {
  const { fiscal,tables,state,service } = fixture();
  state.changeFiscalAfterLaunch = '51';
  await assert.rejects(service().submit(invoice,draft), /XML/i);
  assert.equal(fiscal.IDPEDIDO, null);
  assert.equal(tables.NOTASPENDENTES[0].fields.NOTAFISCAL, 'PENDENTE');
});

test('keeps an actually blank fiscal number eligible', async () => {
  const { fiscal,service } = fixture();
  fiscal.NUMERO_NOTA = null;
  assert.deepEqual(await service().submit({ ...invoice, number:'' },draft), expected);
});

test('checks earlier launches and the order PDF again before promoting and linking', async () => {
  const removals = [
    ({ tables }) => { tables.LANCAMENTOS.shift(); },
    ({ files }) => { files.delete(pdfName); },
  ];
  for (const remove of removals) {
    const { fiscal,events,state,service } = fixture();
    state.afterLaunch = context => { if (context.id === '51') remove(context); };
    await assert.rejects(service().submit(invoice,draft), /diverg|indisponível/);
    assert.equal(fiscal.IDPEDIDO, null);
    assert.equal(events.includes('promote'), false);
    assert.equal(events.includes('link'), false);
  }
});

test('notifies each completed line without letting an observer failure affect posting', async () => {
  const { service } = fixture();
  const counts = [];
  const onProgress = async count => { counts.push(count); throw new Error('observer failed'); };
  assert.deepEqual(await service().submit(invoice,draft,{ onProgress }), expected);
  assert.deepEqual(counts, [{ completedLines:1, totalLines:2 }, { completedLines:2, totalLines:2 }]);
});

test('a changed PDF or altered financial row stops a reserved attempt before remaining writes', async () => {
  const { fiscal,tables,events,state,service } = fixture();
  state.rejectLine = `${key}-2`;
  await assert.rejects(service().submit(invoice,draft));
  state.rejectLine = null;
  state.sourcePdf = wrongPdf;
  await assert.rejects(service().submit(invoice,draft), /PDF|DANFE/);
  state.sourcePdf = pdf;
  tables.LANCAMENTOS[0].fields.field_14 = 'ALTERADO';
  await assert.rejects(service().submit(invoice,draft), /diverg|alterad/i);
  assert.equal(tables.LANCAMENTOS.length, 1);
  assert.equal(fiscal.IDPEDIDO, null);
  assert.equal(events.filter(event => event === 'attach').length, 1);
});

test('keeps a large fiscal draft within the multiline reservation limit and reopens it intact', async () => {
  const { fiscal,state,service } = fixture();
  const largeDraft = { ...draft, description:'Material de construção. '.repeat(3500) };
  state.rejectLine = `${key}-2`;
  await assert.rejects(service().submit(invoice,largeDraft), /launch creation unavailable/);
  assert.ok(fiscal.NFEPROPOSTA.length < 63000);
  assert.deepEqual(await service().loadReservation(invoice), largeDraft);
  state.rejectLine = null;
  assert.deepEqual(await service().submit(invoice,largeDraft), expected);
});

test('stores and reloads a reviewed NF-e draft with 990 fiscal lines', async () => {
  const { fiscal,state,service } = fixture();
  const manyLines = { lines:Array.from({ length:990 }, (_, index) => ({ number:index + 1, account:'A', productId:'1296',
    stageId:'3121', quantity:'10', unitPrice:'9.81', adjustment:'0.00', discount:'0.00', date:'2026-11-08', dueDate:'2026-12-08' })) };
  state.rejectAttachment = true;
  await assert.rejects(service().submit(invoice,manyLines), /attachment upload unavailable/);
  assert.match(fiscal.NFEPROPOSTA, /^gzip:/);
  assert.ok(fiscal.NFEPROPOSTA.length < 63000);
  assert.deepEqual(await service().loadReservation(invoice), manyLines);
});

test('never replaces a different document already stored under the exact DANFE name', async () => {
  const { fiscal,tables,files,events,service } = fixture();
  const unrelated = await wrongPdf.arrayBuffer();
  files.set(pdfName, unrelated);
  await assert.rejects(service().submit(invoice,draft), /PDF.*diverge/);
  assert.equal(fiscal.IDPEDIDO, null);
  assert.equal(tables.LANCAMENTOS.length, 0);
  assert.deepEqual(files.get(pdfName), unrelated);
  assert.equal(events.includes('attach'), false);
});

test('leaves launches untouched when the PDF upload fails and resumes once it succeeds', async () => {
  const { fiscal,tables,events,state,service } = fixture();
  state.rejectAttachment = true;
  await assert.rejects(service().submit(invoice,draft), /attachment upload unavailable/);
  assert.equal(fiscal.IDPEDIDO, null);
  assert.equal(tables.LANCAMENTOS.length, 0);
  assert.deepEqual(events, ['reserve','NOTASPENDENTES:40']);
  state.rejectAttachment = false;
  assert.deepEqual(await service().submit(invoice,draft), expected);
});

test('a failed audit promotion leaves the note unlinked and resumes without repeating financial rows', async () => {
  const { fiscal,tables,events,state,service } = fixture();
  state.rejectPromotion = true;
  await assert.rejects(service().submit(invoice,draft), /promotion unavailable/);
  assert.equal(fiscal.IDPEDIDO, null);
  assert.equal(tables.LANCAMENTOS.length, 2);
  assert.equal(tables.NOTASPENDENTES[0].fields.NOTAFISCAL, 'PENDENTE');
  assert.equal(events.includes('link'), false);
  state.rejectPromotion = false;
  assert.deepEqual(await service().submit(invoice,draft), expected);
  assert.equal(tables.LANCAMENTOS.length, 2);
});

for (const [name, tamper] of [
  ['a changed plan digest', stored => { stored.planHash = 'f'.repeat(64); }],
  ['a changed line in the reviewed draft', stored => { stored.draft.lines[1].account = 'ALTERADA'; }],
  ['a missing fiscal line', stored => { stored.draft.lines.pop(); }],
]) {
  test(`rejects ${name} in a stored reservation before any further writes`, async () => {
    const { fiscal,tables,events,state,service } = fixture();
    state.rejectLine = `${key}-2`;
    await assert.rejects(service().submit(invoice,draft), /launch creation unavailable/);
    const stored = JSON.parse(fiscal.NFEPROPOSTA);
    tamper(stored);
    fiscal.NFEPROPOSTA = JSON.stringify(stored);
    const completed = [...events];
    state.rejectLine = null;
    await assert.rejects(service().submit(invoice,draft), /proposta.*reservad|reserva.*diverg/i);
    assert.equal(fiscal.IDPEDIDO, null);
    assert.equal(tables.LANCAMENTOS.length, 1);
    assert.deepEqual(events, completed);
  });
}

test('requires the financial unique indexes before reserving or creating records', async () => {
  const { fiscal,events,state,service } = fixture();
  state.withoutUniqueConstraint = 'NFELINHA';
  await assert.rejects(service().submit(invoice,draft), /NFELINHA/);
  assert.equal(fiscal.NFEPROPOSTA, null);
  assert.deepEqual(events, []);
});

test('a caller editing its local draft during preflight cannot change the submitted revision', async () => {
  const { tables,state,service } = fixture();
  const editable = structuredClone(draft);
  state.onDownload = () => { editable.lines[0].account = 'C'; };
  assert.deepEqual(await service().submit(invoice,editable), expected);
  assert.equal(tables.LANCAMENTOS[0].fields.field_14, 'A');
});

test('accepts SharePoint numeric and civil date representations of the same saved values', async () => {
  const { state,service } = fixture();
  state.normalizeFinancialReadback = fields => {
    if ('DATAPEDIDO' in fields) Object.assign(fields, { DATAPEDIDO:'2026-11-08T03:00:00Z', VALORTOTAL:'15.00' });
    if ('field_2' in fields) Object.assign(fields, { field_2:'2026-11-08', field_8:'1.000' });
  };
  assert.deepEqual(await service().submit(invoice,draft), expected);
});
