import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { renderChatMarkup, commandFromTarget } from '../src/ui/chat-view.js';
import { projectNfeRows, invoiceXmlFacts } from '../src/chat/nfe-report-model.js';
import { createNfeReportView } from '../src/ui/nfe-report-view.js';

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

test('report shows the fiscal facts, filters by supplier and opens the exact attached PDF', async t => {
  const dom = new JSDOM('<main id="app"><button data-action="open-nfe-report">NFE</button></main>');
  const { document } = dom.window;
  const opener = document.querySelector('button');
  const downloads = [];
  const panel = createNfeReportView({ document, data:{
    loadSnapshot:async () => ({ rows:[invoice] }),
    downloadDocument:async () => new Blob([issuerXml]),
    listAttachments:async id => {
      assert.equal(id, '10');
      return [{ fileName:'Outra-nota.pdf' }, { fileName:pdfName }];
    },
    downloadAttachment:async (id, name) => { downloads.push([id, name]); },
  }, openMediaCollection:async (items, options) => {
    assert.equal(items.length, 1);
    await items[0].source();
    options.onClose();
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  opener.focus();
  await panel.open();
  await new Promise(resolve => setImmediate(resolve));
  const root = panel.element;
  assert.match(root.querySelector('.nfe-card').textContent, /ELÉTRICA TESTE LTDA.*06\/11\/2026.*MEI.*Retenção informada.*CNO consta/);
  const card = root.querySelector('.nfe-card');
  const pdf = card.querySelector('button.nfe-pdf');
  assert.equal(card.querySelector('.nfe-identity').firstElementChild, pdf);
  assert.equal(pdf.getAttribute('aria-label'), 'Abrir DANFE da nota 140');
  assert.equal(pdf.querySelector('svg[aria-hidden="true"] text')?.textContent, 'PDF');
  pdf.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(downloads, [['10', pdfName]]);
  const search = root.querySelector('input');
  search.value = 'eletrica';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.ok(root.querySelector('.nfe-card'));
  search.value = 'empresa inexistente';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelector('.nfe-card'), null);
  panel.close();
  assert.equal(document.activeElement, opener);
  assert.equal(document.getElementById('app').inert, false);
});
