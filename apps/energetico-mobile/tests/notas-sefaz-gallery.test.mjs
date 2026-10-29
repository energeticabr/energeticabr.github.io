import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';

// All values in this file are fictitious; they never enter the live data source.
const sample = { id: '4', fields: { Title: 'FORNECEDOR FICTÍCIO', CHAVE_ACESSO: '1'.repeat(44),
  CNPJ_FORNECEDOR: '00000000000000', NUMERO_NOTA: '123', SERIE: '001', DATA_EMISSAO: '2026-10-29T12:00:00Z',
  VALOR_TOTAL_NOTA: 1250.5, DESCONTOS: 0, VALOR_LIQUIDO: 1250.5, ORIGEM_LIQUIDO: 'XML NF-e',
  SITUACAO: 'Autorizada', STATUS_IMPORTACAO: 'XML completo', DIRECAO: 'Entrada',
  XML_URL: 'https://energeticaltda.sharepoint.com/sites/energetica/Documentos/nota.xml',
  DANFE_URL: { Url: 'https://energeticaltda.sharepoint.com/sites/energetica/Documentos/danfe.pdf', Description: 'DANFE' } } };

test('Suprimentos adds a third gray NF-e gallery below launches and expands the existing blue action', () => {
  const dom = new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Teste' }, messages: [{
    id: 'supplies', role: 'assistant', type: 'poll', question: 'SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?',
    options: [{ id: 'new_document', reply: 'new_document', label: 'LANÇAMENTOS' }, { id: 'payment', label: 'PROVISÃO' }],
  }] }));
  const pair = dom.window.document.querySelector('.chat-supplies-pair');
  assert.deepEqual([...pair.querySelectorAll('.chat-gallery-actions button')].map(button => button.dataset.replyId),
    ['action_orders_gallery', 'action_launch_gallery', 'action_notas_fiscais_sefaz_gallery']);
  assert.ok(pair.classList.contains('chat-supplies-pair--three-galleries'));
  assert.equal(pair.querySelector('.chat-supplies-pair__primary button').dataset.replyId, 'new_document');
  assert.equal(pair.querySelectorAll('.chat-supplies-pair__primary button').length, 1);
  dom.window.close();
});

test('NF-e renders confirmed values, preserves access-key text and exposes only read-only real document links', async t => {
  const dom = new JSDOM('<body/>'), doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: 'notas_fiscais_sefaz', data: { loadSnapshot: async () => ({ rows: [sample] }) } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const row = doc.querySelector('[data-registration-row="4"]');
  assert.match(row.textContent, /FORNECEDOR FICTÍCIO/);
  assert.equal(row.querySelector('[data-field="CHAVE_ACESSO"] dd').textContent, '1'.repeat(44));
  assert.equal(row.querySelector('[data-field="DESCONTOS"] dd').textContent.replace(/\s/g, ''), 'R$0,00');
  assert.equal(row.querySelector('[data-field="VALOR_LIQUIDO"] dd').textContent.replace(/\s/g, ''), 'R$1.250,50');
  assert.equal(row.querySelector('[data-field="DATA_EMISSAO"] dd').textContent, '29/10/2026');
  assert.equal(row.querySelector('[data-field="XML_URL"] a').href, sample.fields.XML_URL);
  assert.equal(row.querySelector('[data-field="DANFE_URL"] a').href, sample.fields.DANFE_URL.Url);
  assert.equal(row.querySelector('[data-field="ULTIMO_DOCUMENTO_URL"] dd').textContent, 'Pendente');
  assert.equal(doc.querySelector('[data-action="create-registration"]'), null);
  assert.equal(row.querySelector('[data-gallery-action]'), null);
  assert.match(doc.querySelector('[data-sefaz-coverage]').textContent, /cobertura.*pendente/i);
});

test('NF-e summary records leave missing amounts and documents pending without deriving net value or active links', async t => {
  const dom = new JSDOM('<body/>'), doc = dom.window.document;
  const fields = { ...sample.fields, VALOR_LIQUIDO: null, DESCONTOS: null, XML_URL: 'javascript:alert(1)',
    DANFE_URL: null, STATUS_IMPORTACAO: 'Resumo; XML pendente' };
  const gallery = createRegistrationGallery({ document: doc, kind: 'notas_fiscais_sefaz', data: { loadSnapshot: async () => ({ rows: [{ id: '5', fields }] }) } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  for (const field of ['VALOR_LIQUIDO', 'DESCONTOS', 'XML_URL', 'DANFE_URL', 'OBSERVACOES_NOTA', 'INFORMACOES_FISCO']) {
    const value = doc.querySelector(`[data-field="${field}"] dd`);
    assert.equal(value.textContent, 'Pendente');
    assert.equal(value.querySelector('a'), null);
  }
});

test('NF-e mostra emissao e dados de conferencia com observacoes literais completas', async t => {
  const dom = new JSDOM('<body/>'), doc = dom.window.document;
  const observation='Pedido 456\nEntregar na obra fictícia.\n<script>alert("texto literal")</script>\n'+'Referência adicional sem espaços: '+ 'A'.repeat(300);
  const fields={...sample.fields, OBSERVACOES_NOTA:observation, INFORMACOES_FISCO:'Informações fiscais fictícias\nSegunda linha',
    DESTINATARIO:'DESTINATÁRIO FICTÍCIO',CNPJ_DESTINATARIO:'00000000000000',UF_FORNECEDOR:'MG',NATUREZA_OPERACAO:'Venda de mercadorias',
    VALOR_PRODUTOS:1200,FRETE:50.5,SEGURO:0,OUTRAS_DESPESAS:0,ICMS:100,IPI:0,PROTOCOLO:'000000000000000',MODELO:'55',STATUS_DANFE:'DISPONIVEL'};
  const gallery=createRegistrationGallery({document:doc,kind:'notas_fiscais_sefaz',data:{loadSnapshot:async()=>({rows:[{id:'4',fields}]})}});
  t.after(()=>{gallery.destroy();dom.window.close();});
  await gallery.open();
  const row=doc.querySelector('[data-registration-row="4"]');
  assert.equal(row.querySelector('[data-field="DATA_EMISSAO"] dt').textContent,'Data de emissão');
  assert.equal(row.querySelector('[data-field="DATA_EMISSAO"] dd').textContent,'29/10/2026');
  for(const field of ['OBSERVACOES_NOTA','INFORMACOES_FISCO','DESTINATARIO','CNPJ_DESTINATARIO','NATUREZA_OPERACAO','PROTOCOLO','MODELO','UF_FORNECEDOR']) {
    assert.equal(row.querySelector(`[data-field="${field}"] dd`).textContent,fields[field],field);
  }
  assert.equal(row.querySelector('[data-field="FRETE"] dd').textContent.replace(/\s/g,''),'R$50,50');
  assert.equal(row.querySelector('[data-field="SEGURO"] dd').textContent.replace(/\s/g,''),'R$0,00');
  assert.equal(row.querySelector('script'),null,'observação deve ser texto, sem executar HTML');
});

test('NF-e data reads every page in the company list and offers no mutations', async () => {
  const calls = [];
  const repository = { async resolveList(site, aliases) { calls.push(['list', site, aliases]); return { status: 'resolved', id: 'nf-list' }; },
    async getColumns() { return []; },
    async getItemsPage(site, list, query, options) {
      calls.push(['page', site, list, query]);
      return options.cursor === 'second-page' ? { items: [{ id: '5', fields: { Title: 'Resumo fictício', DATA_EMISSAO: '2026-01-02' } }], hasMore: false, nextLink: null }
        : { items: [sample], hasMore: true, nextLink: 'second-page' };
    } };
  const data = createRegistrationGalleryData({ kind: 'notas_fiscais_sefaz', repository });
  const snapshot = await data.loadSnapshot();
  assert.equal(snapshot.rows.length, 2);
  assert.deepEqual(calls[0], ['list', 'company', ['NOTAS_FISCAIS_SEFAZ']]);
  assert.equal(calls.filter(call => call[0] === 'page').length, 2);
  assert.equal(snapshot.rows[0].fields.VALOR_LIQUIDO, 1250.5);
  assert.equal(snapshot.rows[1].fields.VALOR_LIQUIDO, undefined);
  assert.equal(data.saveRecord, undefined);
  assert.equal(data.deleteRecord, undefined);
});

test('NF-e exibe o dia original do XML mesmo quando SharePoint normaliza timestamp em UTC', async t=>{
  const dom=new JSDOM('<body/>'),doc=dom.window.document;
  const fields={...sample.fields,DATA_EMISSAO:'2026-10-30T02:30:00Z',DATA_EMISSAO_ORIGINAL:'2026-10-29T23:30:00-03:00'};
  const gallery=createRegistrationGallery({document:doc,kind:'notas_fiscais_sefaz',data:{loadSnapshot:async()=>({rows:[{id:'4',fields}]})}});
  t.after(()=>{gallery.destroy();dom.window.close();});
  await gallery.open();
  assert.equal(doc.querySelector('[data-field="DATA_EMISSAO"] dd').textContent,'29/10/2026');
});

test('NF-e completa distingue observacao ausente de resumo ainda pendente',async t=>{
  const dom=new JSDOM('<body/>'),doc=dom.window.document;
  const fields={...sample.fields,STATUS_IMPORTACAO:'XML_COMPLETO'};
  const gallery=createRegistrationGallery({document:doc,kind:'notas_fiscais_sefaz',data:{loadSnapshot:async()=>({rows:[{id:'4',fields}]})}});
  t.after(()=>{gallery.destroy();dom.window.close();});
  await gallery.open();
  for(const field of ['OBSERVACOES_NOTA','INFORMACOES_FISCO'])assert.equal(doc.querySelector(`[data-field="${field}"] dd`).textContent,'Não consta na nota');
});

test('NF-e source uses company SharePoint REST with read-only authorization and explicit fields', async () => {
  const calls = [], scopes = [];
  const data = createRegistrationGalleryData({ kind: 'notas_fiscais_sefaz',
    siteConfig: { company: { host: 'tenant.sharepoint.com', path: '/sites/company', readTransport: 'graph' } },
    tokenProvider: async requested => { scopes.push(...requested); return 'fictitious-token'; },
    fetchImpl: async (url, options) => {
      calls.push(String(url)); assert.equal(options.method, 'GET');
      let value;
      if (String(url).includes('/fields?')) value = [{ InternalName: 'Title', Title: 'Fornecedor', TypeAsString: 'Text' }];
      else if (String(url).includes('/items?')) {
        const query = new URL(String(url)).searchParams;
        for (const name of ['CHAVE_ACESSO','DATA_EMISSAO','DATA_EMISSAO_ORIGINAL','VALOR_LIQUIDO','DESCONTOS','XML_URL','DANFE_URL','STATUS_IMPORTACAO','OBSERVACOES_NOTA','INFORMACOES_FISCO','NATUREZA_OPERACAO','CNPJ_DESTINATARIO','FRETE','PROTOCOLO']) assert.ok(query.get('$select').split(',').includes(name),name);
        assert.equal(query.has('$expand'), false);
        value = [{ Id: 4, ...sample.fields }];
      } else if (String(url).includes('/_api/web/lists?')) value = [{ Id: '11111111-2222-3333-4444-555555555555', Title: 'NOTAS_FISCAIS_SEFAZ', BaseTemplate: 100, Hidden: false }];
      else throw new Error('Unexpected fixture request ' + url);
      return new Response(JSON.stringify({ value }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal((await data.loadSnapshot()).rows[0].id, '4');
  assert.ok(calls.every(url => url.startsWith('https://tenant.sharepoint.com/sites/company/_api/')));
  assert.ok(scopes.every(scope => scope === 'https://tenant.sharepoint.com/AllSites.Read'));
});

test('NF-e document downloads use authenticated REST only inside the configured company site', async () => {
  const calls = [], scopes = [];
  const data = createRegistrationGalleryData({ kind: 'notas_fiscais_sefaz',
    siteConfig: { company: { host: 'tenant.sharepoint.com', path: '/sites/company' } },
    tokenProvider: async requested => { scopes.push(...requested); return 'fictitious-token'; },
    fetchImpl: async (url, options) => {
      calls.push(String(url)); assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer fictitious-token');
      assert.ok(String(url).includes('GetFileByServerRelativePath'));
      return new Response('%PDF-fictitious', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    },
  });
  assert.equal(typeof data.downloadDocument, 'function');
  const blob = await data.downloadDocument('https://tenant.sharepoint.com/sites/company/Documentos/DANFE%20teste.pdf');
  assert.equal(blob.type, 'application/pdf');
  assert.equal(await blob.text(), '%PDF-fictitious');
  for (const url of ['https://foreign.example/sites/company/nota.xml', 'https://tenant.sharepoint.com/sites/other/nota.xml',
    'https://tenant.sharepoint.com/sites/company/%2e%2e%2fother/nota.xml', 'https://user:secret@tenant.sharepoint.com/sites/company/nota.xml', 'javascript:alert(1)']) {
    await assert.rejects(() => data.downloadDocument(url), /documento.*inválido/i);
  }
  assert.equal(calls.length, 1);
  assert.deepEqual(scopes, ['https://tenant.sharepoint.com/AllSites.Read']);
});

test('NF-e document links open through the app preview with a lazy authenticated download', async t => {
  const opened = [], downloads = [];
  const dom = new JSDOM('<body/>'), doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: 'notas_fiscais_sefaz', data: {
    loadSnapshot: async () => ({ rows: [sample] }),
    downloadDocument: async (url, options) => { downloads.push([url, options]); return new Blob(['%PDF-fictitious'], { type: 'application/pdf' }); },
  }, openMediaCollection: items => opened.push(items) });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const link = doc.querySelector('[data-field="DANFE_URL"] a');
  assert.equal(link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })), false);
  assert.equal(opened.length, 1);
  assert.equal(downloads.length, 0);
  assert.equal(opened[0][0].fileName, 'danfe.pdf');
  const signal = new AbortController().signal;
  const blob = await opened[0][0].source({ signal });
  assert.equal(blob.type, 'application/pdf');
  assert.equal(downloads[0][0], sample.fields.DANFE_URL.Url);
  assert.equal(downloads[0][1].signal, signal);
});
