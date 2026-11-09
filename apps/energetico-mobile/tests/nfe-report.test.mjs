import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { renderChatMarkup, commandFromTarget } from '../src/ui/chat-view.js';
import { projectNfeRows, invoiceXmlFacts } from '../src/chat/nfe-report-model.js';
import { buildFilteredReportPdf } from '../src/chat/filtered-report-pdf.js';
import { createNfeReportView } from '../src/ui/nfe-report-view.js';
import { decorateReportPrint } from '../src/ui/report-print.js';

test('NFE uses the DDA drawing and opens its own report from the home menu', () => {
  const dom = new JSDOM(renderChatMarkup({ sessionStatus:'authenticated', account:{ name:'Teste' }, messages:[
    { role:'assistant', type:'poll', question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',
      options:['PENDÊNCIAS','SUPRIMENTOS','FINANCEIRO','RECURSOS HUMANOS'].map((label,i) =>
        ({ id:['group_pending','group_supplies','group_financial','group_hr'][i], label })) },
  ] }));
  try {
    const doc = dom.window.document;
    const provisions = doc.querySelector('[data-action="open-pending-provisions"]');
    const nfe = doc.querySelector('[data-action="open-nfe-report"]');
    const dda = doc.querySelector('[data-action="open-dda-report"]');
    assert.equal(commandFromTarget(nfe)?.type, 'open-nfe-report');
    assert.equal(nfe.nextElementSibling, dda);
    assert.equal(nfe.querySelector('img').src, dda.querySelector('img').src);
    assert.equal(nfe.textContent, 'NFE');
    assert.equal(provisions.nextElementSibling.querySelector('button').dataset.action, 'open-commercial-receipts');
  } finally { dom.window.close(); }
});

test('NFE shortcut uses the authenticated fiscal source and ends its session at logout', async t => {
  const handlers = new Map(), opens = [], kinds = [];
  let sessionCheck, destroyed = false;
  const view = {
    render(){}, focusComposer(){}, destroy(){},
    on(type, handler){ handlers.set(type, handler); return () => handlers.delete(type); },
  };
  const controller = createAppController({
    store:createConversationStore(), view,
    auth:{ initialize:async () => ({ homeAccountId:'nfe-test', name:'Teste' }), signOut:async () => {} },
    client:{ sendText:async () => ({ status:'processed', messages:[] }) },
    native:{ importSharedItems:async () => [] },
    registrationGalleryDataFactory:async ({kind,assertSession}) => { kinds.push(kind); sessionCheck = assertSession; return {}; },
    nfeReportFactory:async () => ({ open(){ opens.push('NFE'); }, close(){}, destroy(){ destroyed = true; } }),
    pendingProvisionAttachmentsDataFactory:async () => ({ loadUpcomingPayments:async () => [] }),
    pendingConstructionDiaryDataFactory:async () => ({ loadPending:async () => [] }),
    diaryFieldVisitDataFactory:async () => ({ load:async () => [] }),
  });
  t.after(() => controller.stop());
  await controller.start();
  await handlers.get('open-nfe-report')?.({ type:'open-nfe-report' });
  assert.deepEqual(opens, ['NFE']);
  assert.deepEqual(kinds, ['notas_fiscais_sefaz']);
  assert.doesNotThrow(sessionCheck);
  await handlers.get('sign-out')({ type:'sign-out' });
  assert.equal(destroyed, true);
  assert.throws(sessionCheck);
});

const key = '1'.repeat(44);
const serviceKey = '2'.repeat(50);
const xmlUrl = 'https://example.sharepoint.com/fiscal/nota.xml';
const pdfName = `DANFE-${key}-deadbeefdeadbeef.pdf`;
const invoice = { id:'10', fields:{
  MODELO:'55', CHAVE_ACESSO:key, XML_URL:{ Url:xmlUrl }, DANFE_URL:{ Url:`https://example.sharepoint.com/Attachments/10/${pdfName}` },
  Title:'ELÉTRICA TESTE LTDA', STATUS_IMPORTACAO:'XML_COMPLETO', SITUACAO:'AUTORIZADA', DIRECAO:'ENTRADA',
  DATA_EMISSAO:'2026-11-07T02:51:00Z', DATA_EMISSAO_ORIGINAL:'2026-11-06T23:51:00-03:00', NUMERO_NOTA:'140',
  STATUS_RETENCOES:'RETENCAO_INFORMADA_XML', IRRF_RETIDO:15, TOTAL_RETIDO:15, VALOR_TOTAL_NOTA:1500,
  OBSERVACOES_NOTA:'CNO 90.025.44060/72',
} };
const serviceXml = code => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${serviceKey}">
  <DPS><infDPS><prest><regTrib><opSimpNac>2</opSimpNac></regTrib></prest>
  <serv><obra><cObra>${code}</cObra></obra></serv>
  <valores><trib><tribMun><tpRetISSQN>3</tpRetISSQN></tribMun></trib></valores>
  </infDPS></DPS></infNFSe></NFSe>`;
const issuerXml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}">
  <emit><CRT>4</CRT></emit></infNFe></NFe></nfeProc>`;

test('fiscal rows follow the original emission calendar and distinguish incomplete XML', () => {
  const [pending, complete, noRetention] = projectNfeRows([
    invoice,
    { id:'11', fields:{ ...invoice.fields, TIPO_FISCAL:'NFS-e', DATA_EMISSAO_ORIGINAL:'2026-11-07',
      STATUS_IMPORTACAO:'RESUMO', OBSERVACOES_NOTA:'', CHAVE_ACESSO:serviceKey } },
    { id:'9', fields:{ MODELO:'55', DATA_EMISSAO:'2026-11-06T22:00:00-03:00',
      STATUS_IMPORTACAO:'XML_COMPLETO', STATUS_RETENCOES:'NAO_INFORMADA_XML' } },
    { id:'12', fields:{ MODELO:'57', DATA_EMISSAO:'2026-11-09' } },
  ]);
  assert.deepEqual([pending.id, complete.id, noRetention.id], ['11','10','9']);
  assert.deepEqual([pending.retention, pending.cnoState, pending.total, pending.xmlUrl], ['unknown','unknown',null,'']);
  assert.deepEqual([complete.date, complete.retention, complete.withholding.total, complete.cnoState], ['2026-11-06','yes',15,'valid']);
  assert.deepEqual([noRetention.retention, noRetention.cnoState], ['no','missing']);
});

test('supplier regime comes from the issuer of the matching fiscal XML', () => {
  const dom = new JSDOM();
  try {
    const { DOMParser } = dom.window;
    const parse = (xml, type = 'NF-e', id = key) => invoiceXmlFacts(xml, {type, key:id}, DOMParser)?.regime || '';
    assert.equal(parse(issuerXml), 'MEI');
    assert.equal(parse(issuerXml, 'NF-e', '3'.repeat(44)), '');
    assert.equal(parse(issuerXml.replace('<emit>', '<dest>').replace('</emit>', '</dest>')), '');
    const service = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${serviceKey}">
      <DPS><infDPS><prest><regTrib><opSimpNac>3</opSimpNac></regTrib></prest></infDPS></DPS></infNFSe></NFSe>`;
    assert.equal(parse(service, 'NFS-e', serviceKey), 'Simples Nacional · ME/EPP');
    assert.equal(parse('<!DOCTYPE NFe>' + issuerXml), '');
  } finally { dom.window.close(); }
});

test('NFS-e reads a CNO/CEI and declared ISS retention even if missing from the SharePoint projection', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const services = ['900254406072','123456789012'].map((code, index) => ({
    id:String(index + 1), fields:{ TIPO_FISCAL:'NFS-e', CHAVE_ACESSO:serviceKey, XML_URL:`${xmlUrl}?${code}`,
      STATUS_IMPORTACAO:'XML_COMPLETO', STATUS_RETENCOES:'NAO_INFORMADA_XML' },
  }));
  const panel = createNfeReportView({ document:dom.window.document, data:{
    loadSnapshot:async () => ({ rows:services }),
    downloadDocument:async url => new Blob([serviceXml(url.split('?').at(-1))]),
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  await new Promise(resolve => setImmediate(resolve));
  const note = id => panel.element.querySelector(`[data-invoice-id="${id}"]`).textContent;
  assert.match(note('1'), /MEI.*Retenção informada.*CNO consta.*90\.025\.44060\/72/);
  assert.match(note('2'), /Retenção informada.*CNO\/CEI informado.*123456789012/);
});

test('report shows fiscal facts, filters by supplier and opens the exact DANFE followed by its correction PDFs', async t => {
  const dom = new JSDOM('<main id="app"><button data-action="open-nfe-report">NFE</button></main>');
  const { document } = dom.window;
  const opener = document.querySelector('button');
  const downloads = [];
  const firstCorrection = `CCe-${key}-110110-01.pdf`;
  const secondCorrection = `CCe-${key}-110110-02.pdf`;
  const panel = createNfeReportView({ document, data:{
    loadSnapshot:async () => ({ rows:[invoice] }),
    downloadDocument:async () => new Blob([issuerXml]),
    listAttachments:async (id, { refresh }) => {
      assert.equal(id, '10');
      assert.equal(refresh, true);
      return ['Outra-nota.pdf', secondCorrection, pdfName, firstCorrection, firstCorrection.toUpperCase(),
        firstCorrection.replace(key, '3'.repeat(44)), firstCorrection.replace('.pdf', '.xml')].map(fileName => ({ fileName }));
    },
    downloadAttachment:async (id, name) => { downloads.push([id, name]); },
  }, openMediaCollection:async (items, options) => {
    for (const item of items) await item.source();
    options.onClose();
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  opener.focus();
  await panel.open();
  await new Promise(resolve => setImmediate(resolve));
  const root = panel.element;
  const row = root.querySelector('table tbody tr');
  assert.match(row.textContent, /ELÉTRICA TESTE LTDA.*06\/11\/2026.*MEI.*Retenção informada.*CNO consta/);
  const pdf = row.querySelector('button.nfe-pdf');
  assert.ok(row.cells[0].contains(pdf));
  assert.equal(root.querySelector('.nfe-metrics').nextElementSibling.className, 'nfe-feedback');
  assert.equal(pdf.getAttribute('aria-label'), 'Abrir DANFE da nota 140');
  assert.equal(pdf.querySelector('svg[aria-hidden="true"] text')?.textContent, 'PDF');
  pdf.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(downloads, [['10', pdfName], ['10', firstCorrection], ['10', secondCorrection]]);
  const search = root.querySelector('input');
  search.value = 'eletrica';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.ok(root.querySelector('table tbody tr'));
  search.value = 'empresa inexistente';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelector('table tbody tr'), null);
  panel.close();
  assert.equal(document.activeElement, opener);
  assert.equal(document.getElementById('app').inert, false);
});

test('a registered CC-e stays accessible in the report while the DANFE is pending', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const fileName = `CCe-${key}-110110-01.pdf`;
  const fields = { ...invoice.fields, DANFE_URL:'', STATUS_IMPORTACAO:'EVENTO_SEM_XML',
    CARTAS_CORRECAO_JSON:JSON.stringify({ version:1, key, events:[{
      eventId:`ID110110${key}01`, sequence:1, eventType:'110110', cStat:'135', protocol:'1'.repeat(15),
      correction:'Corrigir a descrição do material.', issuedAt:'2026-11-07T08:00:00-03:00',
      xmlSha256:'a'.repeat(64), pdfSha256:'b'.repeat(64), fileName,
    }] }),
  };
  const shown = [];
  const panel = createNfeReportView({ document:dom.window.document, data:{
    loadSnapshot:async () => ({ rows:[{ id:'10', fields }] }),
    listAttachments:async () => [{ fileName }],
    downloadAttachment:async (id, name) => { shown.push([id, name]); },
  }, openMediaCollection:async (items, options) => {
    await items[0].source();
    options.onClose();
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  const row = panel.element.querySelector('tbody tr');
  assert.match(row.textContent, /1 CC-e/);
  row.querySelector('button.nfe-pdf').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(shown, [['10', fileName]]);
});

test('NFE printer captures all filtered pages with XML facts and preserves the page in view', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const rows = Array.from({ length:13 }, (_, i) => ({ ...invoice, id:String(i + 1),
    fields:{ ...invoice.fields, Title:`Fornecedor ${i + 1}`, NUMERO_NOTA:String(100 + i),
      SITUACAO:i === 11 ? 'CANCELADA' : 'AUTORIZADA', STATUS_IMPORTACAO:i === 12 ? 'RESUMO' : 'XML_COMPLETO' } }));
  rows.push({ id:'14', fields:{ ...invoice.fields, TIPO_FISCAL:'NFS-e', Title:'Serviço fora do filtro' } });
  let resolvePreview;
  const preview = new Promise(resolve => { resolvePreview = resolve; });
  const panel = decorateReportPrint(createNfeReportView({ document:dom.window.document, data:{
    loadSnapshot:async () => ({ rows }), downloadDocument:async () => new Blob([issuerXml]),
  } }), {
    action:'open-nfe-report', loadLogo:async () => new Uint8Array(), buildPdf:async snapshot => snapshot,
    previewMedia:resolvePreview,
  });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  const { element } = panel;
  const type = element.querySelector('select');
  type.value = 'NF-e';
  type.dispatchEvent(new dom.window.Event('change'));
  const measures = [...element.querySelectorAll('.nfe-metrics dd')].map(node => node.textContent.replace(/\s/g, ' '));
  assert.deepEqual(measures, ['13', 'R$ 16.500,00', '06/11/2026', '12']);
  element.querySelector('.nfe-pager button:last-child').click();
  const currentRow = element.querySelector('tbody tr');
  assert.equal(currentRow.dataset.invoiceId, '1');
  element.querySelector('[data-action="print-report-pdf"]').click();
  const snapshot = await preview;
  const table = snapshot.pages[0].blocks.find(block => block.type === 'table');
  assert.equal(snapshot.title, 'Relatório de notas fiscais');
  assert.equal(table.rows.length, 14);
  assert.match(JSON.stringify(table.rows.at(-1)), /Fornecedor 1.*MEI/);
  assert.doesNotMatch(JSON.stringify(table), /Serviço fora do filtro/);
  assert.equal(element.querySelector('tbody tr'), currentRow);
  const pdf = await buildFilteredReportPdf(snapshot);
  assert.equal(pdf.type, 'application/pdf');
  assert.ok((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount() > 0);
});

test('fiscal filters cover every page and combine document, search and XML classifications', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const { document, Event } = dom.window;
  const notes = Array.from({ length:13 }, (_, index) => ({
    id:String(index + 20),
    fields:{ ...invoice.fields, Title:'Materiais Exemplo', XML_URL:xmlUrl,
      OBSERVACOES_NOTA:'', STATUS_RETENCOES:'NAO_INFORMADA_XML' },
  }));
  const service = {
    id:'19', fields:{ ...invoice.fields, Title:'Serviço Exemplo', TIPO_FISCAL:'NFS-e',
      CHAVE_ACESSO:serviceKey, XML_URL:xmlUrl + '?service', OBSERVACOES_NOTA:'',
      STATUS_RETENCOES:'NAO_INFORMADA_XML', VALOR_TOTAL_NOTA:25 },
  };
  notes.push(service,
    { id:'18', fields:{ ...invoice.fields, OBSERVACOES_NOTA:'CNO 12.345.67890/12', XML_URL:xmlUrl + '?normal' } },
    { id:'17', fields:{ ...service.fields, XML_URL:xmlUrl + '?unavailable' } },
    { id:'16', fields:{ ...service.fields, STATUS_IMPORTACAO:'RESUMO' } });
  const downloaded = [];
  const panel = createNfeReportView({ document, data:{
    loadSnapshot:async () => ({ rows:notes }),
    downloadDocument:async url => {
      downloaded.push(url);
      if (url.endsWith('?unavailable')) throw new Error('Indisponível');
      if (url.endsWith('?service')) return new Blob([serviceXml('900254406072')]);
      return new Blob([issuerXml.replace('<CRT>4', url.endsWith('?normal') ? '<CRT>3' : '<CRT>2')]);
    },
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  const { element } = panel;
  const ids = () => [...element.querySelectorAll('tbody tr')].map(row => row.dataset.invoiceId);
  const filter = (name, value, event = 'change') => {
    const control = element.querySelector('select[name="' + name + '"], input[name="' + name + '"]');
    assert.ok(control, name);
    control.value = value;
    assert.equal(control.value, value);
    control.dispatchEvent(new Event(event));
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));

  assert.equal(ids().includes('19'), false);
  assert.equal(downloaded.includes(xmlUrl + '?service'), false);
  filter('retention', 'yes');
  filter('cno', 'valid');
  filter('regime', 'MEI');
  filter('document', 'NFS-e');
  filter('search', 'servico', 'input');
  await settle();
  assert.deepEqual(ids(), ['19']);
  assert.deepEqual([...element.querySelectorAll('.nfe-metrics dd')].slice(0, 2)
    .map(node => node.textContent.replace(/\s/g, ' ')), ['1', 'R$ 25,00']);
  const snapshot = await panel.capturePrint({ title:'Notas filtradas' });
  const printed = snapshot.pages[0].blocks.find(block => block.type === 'table');
  assert.equal(printed.rows.length, 2);
  assert.match(JSON.stringify(printed.rows[1]), /Serviço Exemplo.*MEI.*Retenção informada.*CNO consta/);

  filter('search', '', 'input');
  filter('document', '');
  filter('regime', '');
  filter('cno', 'conflict');
  await settle();
  assert.deepEqual(ids(), ['18']);

  filter('retention', 'no');
  filter('cno', 'missing');
  filter('regime', 'Simples Nacional');
  await settle();
  assert.equal(ids().length, 12);
  assert.equal(element.querySelector('.nfe-metrics dd').textContent, '13');
  element.querySelector('.nfe-pager button:last-child').click();
  assert.deepEqual(ids(), ['20']);
  filter('regime', 'Regime normal');
  await settle();
  assert.deepEqual(ids(), []);
  filter('retention', 'yes');
  filter('cno', '');
  await settle();
  assert.deepEqual(ids(), ['18']);

  panel.close();
  await panel.open();
  assert.deepEqual([...element.querySelectorAll('.nfe-filters select')].map(select => select.value), ['', '', '', '']);
});

test('NFE opens PEDIDOS with ranked suggestions, preserves the report and displays the verified link', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const { document } = dom.window;
  let saved = '';
  let failOnce = true;
  const writes = [];
  const report = createNfeReportView({ document, data:{
    loadSnapshot:async () => ({ rows:[{ ...invoice, fields:{ ...invoice.fields, IDPEDIDO:saved } }] }),
    downloadDocument:async () => new Blob([issuerXml]),
    orderLink:{
      loadOptions:async () => [
        { id:'38', supplier:'Outro fornecedor', amount:2200 },
        { id:'37', supplier:'Elétrica Teste', amount:1490 },
      ],
      async save({ invoiceId, orderId, expectedOrderId }) {
        writes.push([invoiceId, orderId, expectedOrderId]);
        if (failOnce) { failOnce = false; throw new Error('conflito'); }
        saved = orderId;
        return { invoiceId, orderId };
      },
    },
  } });
  t.after(() => { report.destroy(); dom.window.close(); });
  await report.open();
  const { element } = report;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const pencil = () => element.querySelector('.nfe-link-pencil');
  assert.equal(element.querySelector('th:last-child').textContent, 'VINCULAÇÃO');
  const body = element.querySelector('.nfe-body');
  body.scrollLeft = 80;
  body.scrollTop = 120;
  pencil().click();
  await tick();
  const picker = element.querySelector('.dda-provision-dialog');
  assert.match(picker.textContent, /PEDIDO/);
  const choices = [...picker.querySelectorAll('input[type=radio]')];
  assert.deepEqual(choices.map(input => [input.value, input.checked]), [['37',false], ['38',false]]);
  assert.match(choices[0].parentElement.textContent, /razão social/i);
  assert.deepEqual(writes, []);
  choices[0].click();
  for (let i = 0; i < 2; i++) {
    picker.querySelector('.dda-provision-save').click();
    const review = document.querySelector('[data-edit-review]');
    assert.match(review.textContent, /Elétrica Teste/);
    review.querySelector('[data-edit-review-confirm]').click();
    await tick();
    if (i === 0) {
      assert.ok(pencil());
      assert.equal(choices[0].disabled, false);
      assert.match(picker.querySelector('[role=alert]').textContent, /não foi possível confirmar/i);
    }
  }
  assert.deepEqual(writes, [['10','37',''],['10','37','']]);
  assert.ok(choices.every(input => input.disabled));
  assert.equal(pencil(), null);
  assert.equal(element.querySelector('.nfe-link-linked').textContent, 'ID 37');
  assert.equal(body.scrollLeft, 80);
  assert.equal(body.scrollTop, 120);
  picker.querySelector('.gallery-record-dialog-button').click();
  const edit = element.querySelector('.nfe-link-edit');
  assert.equal(element.querySelector('.nfe-link-linked').nextElementSibling, edit);
  assert.equal(document.activeElement, edit);
  edit.click();
  await tick();
  const editor = element.querySelector('.dda-provision-dialog');
  assert.equal(editor.querySelector('input[type=radio]:checked').value, '37');
  const submit = editor.querySelector('.dda-provision-save');
  assert.equal(submit.disabled, true);
  editor.querySelector('input[value="38"]').click();
  editor.querySelector('input[value="37"]').click();
  assert.equal(submit.disabled, true);
  editor.querySelector('input[value="38"]').click();
  submit.click();
  const changes = document.querySelector('[data-edit-review]');
  assert.match(changes.textContent, /ID 37.*#38/s);
  changes.querySelector('[data-edit-review-confirm]').click();
  await tick();
  assert.deepEqual(writes.at(-1), ['10','38','37']);
  assert.equal(element.querySelector('.nfe-link-linked').textContent, 'ID 38');
  assert.ok(element.querySelector('.nfe-link-edit'));
  report.close();
  await report.open();
  assert.equal(element.querySelector('.nfe-link-linked').textContent, 'ID 38');
  assert.equal(pencil(), null);
});

test('NFE pencil opens the proposal beside order choices and submits the edited catalog draft', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const { document, Event } = dom.window;
  const writes = [];
  const fiscal = { issueDate:'2026-11-06', dueDate:'2026-11-15', total:'1500.00', lines:[
    { number:'1', description:'CIMENTO EXEMPLO', unit:'SC', quantity:'3', unitPrice:'500', adjustment:'0', discount:'0' },
  ] };
  const catalog = {
    suppliers:[{ id:'1',label:'ELÉTRICA TESTE LTDA',branch:'OBRA A' },{ id:'2',label:'OUTRO',branch:'OBRA B' }],
    branches:[{ id:'10',label:'OBRA A' },{ id:'11',label:'OBRA B' }],
    products:[{ id:'20',label:'CIMENTO EXEMPLO',unit:'SACO',expenseType:'MATERIAL' }],
    stages:[{ id:'30',label:'FUNDAÇÃO',branch:'OBRA A' },{ id:'31',label:'ESTRUTURA',branch:'OBRA B' }],
    accounts:[{ id:'40',label:'CONTA TESTE' }],history:[],
  };
  const draft = {
    supplierId:'1', branchId:'10', accountId:'40', date:fiscal.issueDate,
    lines:[{ ...fiscal.lines[0], productId:'20',stageId:'30',date:fiscal.issueDate,dueDate:fiscal.dueDate }],
  };
  const report = createNfeReportView({ document, data:{
    loadSnapshot:async () => ({ rows:[invoice] }),
    downloadDocument:async () => new Blob([issuerXml]),
    orderLink:{ loadOptions:async () => [], async save() { throw new Error('unexpected'); } },
    proposal:{
      load:async () => ({ fiscal,catalog,draft,reserved:false }),
      async submit(row, edited) {
        writes.push([row.id, structuredClone(edited)]);
        return { invoiceId:row.id, orderId:'48', launchIds:['61'] };
      },
    },
  } });
  t.after(() => { report.destroy(); dom.window.close(); });
  await report.open();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const root = report.element;
  root.querySelector('.nfe-link-pencil').click();
  root.querySelector('[data-nfe-propose-launch]').click();
  await tick();
  assert.ok(root.querySelector('.nfe-proposal-dialog'));
  assert.equal(writes.length, 0);
  const select = root.querySelector('[name="supplierId"]');
  select.value = '2';
  select.dispatchEvent(new Event('change',{ bubbles:true }));
  assert.equal(root.querySelector('[name="branchId"]').value, '11');
  assert.equal(root.querySelector('[name="accountId"]').value, '');
  root.querySelector('[name="accountId"]').value = '40';
  root.querySelector('[name="accountId"]').dispatchEvent(new Event('change',{ bubbles:true }));
  const line = root.querySelector('.nfe-proposal-line');
  line.open = true;
  line.dispatchEvent(new Event('toggle'));
  const stage = line.querySelector('[name="stageId"]');
  assert.deepEqual([...stage.options].map(option => option.value), ['', '31']);
  assert.equal(stage.value, '31');
  const input = line.querySelector('[name="discount"]');
  input.value = '5,00';
  input.dispatchEvent(new Event('input',{ bubbles:true }));
  assert.match(root.querySelector('[data-nfe-proposal-total]').textContent, /1\.495,00/);
  root.querySelector('[data-nfe-proposal-submit]').click();
  await tick();
  assert.equal(writes[0][0], '10');
  assert.deepEqual([writes[0][1].supplierId,writes[0][1].branchId,writes[0][1].lines[0].stageId,writes[0][1].lines[0].discount],
    ['2','11','31','5,00']);
  assert.equal(root.querySelector('.nfe-link-linked').textContent, 'ID 48');
});
