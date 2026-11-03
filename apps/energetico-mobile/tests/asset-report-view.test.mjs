import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createAssetReportView } from '../src/ui/asset-report-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function report(id = '96') {
  return { assetId: id, asset: { id, fields: { IMOBILIZADO: 'GUINCHO DE TESTE' }, details: [
    { name: 'ITEM', label: 'IMOBILIZADO', value: 'GUINCHO DE TESTE', type: 'text' },
    { name: 'VALORRESIDUAL', label: 'Valor residual', value: 4723.9, type: 'currency' },
    { name: 'FUNCAO', label: 'FUNÇÃO', value: '<img src=x onerror=alert(1)>', type: 'text' },
    { name: 'PERCENTUAL', label: '% DEPRECIAÇÃO', value: 3, type: 'percentWhole' },
    { name: 'DATACOMPRA', label: 'Data compra', value: '2025-01-01T03:00:00Z', type: 'date' },
  ] }, historyTotal: 146.1, history: [
    { id: '275', fields: { IMOBILIZADO: '', FILIAL: 'FILIAL HISTÓRICA', 'ID IMOBILIZADO': Number(id), 'DATA DE DEPRECIAÇÃO': '2026-11-01T03:00:00Z',
      '% DEPRECIAÇÃO': 0.03, 'VALOR DEPRECIAÇÃO': 146.1, 'VALOR RESIDUAL': 4723.9, 'ID LANÇAMENTO': 4321, 'NÚMERO DO PEDIDO': 494 } },
    { id: '250', fields: { FILIAL: 'FILIAL HISTÓRICA', 'ID IMOBILIZADO': Number(id), 'DATA DE DEPRECIAÇÃO': '2026-10-01', '% DEPRECIAÇÃO': 0.03,
      'VALOR DEPRECIAÇÃO': 0, 'VALOR RESIDUAL': 4870, 'ID LANÇAMENTO': null } },
  ] };
}
function domFor(t) { const dom = new JSDOM('<!doctype html><body><section id="host"><button id="trigger">Bem</button><div id="background"></div></section></body>'); t.after(() => dom.window.close()); return dom; }

test('toque nos cartões das duas galerias usa o ID do bem e retorna à mesma página, busca e posição', async t => {
  for (const kind of ['assetLaunches', 'asset']) {
    const dom = domFor(t), doc = dom.window.document, calls = [];
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(kind === 'assetLaunches' ? 275 + i : 96 + i), hasAttachments: false,
      fields: { IMOBILIZADO: `GUINCHO DE TESTE ${i}`, 'ID IMOBILIZADO': 96 + i, FILIAL: 'FILIAL TESTE' } }));
    const gallery = createRegistrationGallery({ document: doc, kind, data: {
      async loadSnapshot() { return { rows }; }, async loadAssetReport(id) { calls.push(id); return report(id); },
    } }); t.after(() => gallery.destroy()); await gallery.open();
    const search = doc.querySelector('input[type="search"]'); search.value = 'GUINCHO'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const root = doc.querySelector('[data-gallery-kind]');
    [...doc.querySelectorAll('.rg-pagination button')].find(b => b.textContent === 'Próxima').click();
    root.scrollTop = 440;
    const trigger = root.querySelector('[data-asset-report-trigger]'); trigger.focus(); trigger.click(); await tick();
    const expectedId = kind === 'assetLaunches' ? '96' : '116';
    assert.deepEqual(calls, [expectedId]);
    const modal = doc.querySelector(`[data-asset-report="${expectedId}"]`); assert.ok(modal);
    assert.match(modal.textContent, /Dados cadastrais/); assert.match(modal.textContent, /Histórico de depreciação/);
    assert.ok(modal.textContent.indexOf('Dados cadastrais') < modal.textContent.indexOf('Histórico de depreciação'));
    assert.match(modal.textContent, /4\.723,90/); assert.match(modal.textContent, /146,10/); assert.match(modal.textContent, /01\/11\/2026/);
    assert.match(modal.textContent, /3%/); assert.doesNotMatch(modal.textContent, /300%/);
    assert.equal(modal.querySelector('img'), null); assert.doesNotMatch(modal.textContent, /<img src=x/);
    assert.equal(modal.querySelectorAll('[data-asset-history-row]').length, 2);
    assert.equal(modal.querySelector('[data-asset-history-row="250"] [data-history-financial-id]').textContent, '—');
    assert.match(modal.querySelector('[data-asset-history-row="275"] [data-history-financial-id]').textContent, /4321/);
    assert.equal(modal.querySelector('[data-asset-history-row="275"] [data-history-order-id]').textContent, '494');
    assert.equal(modal.querySelector('[data-asset-history-row="250"] [data-history-order-id]').textContent, '—');
    modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(doc.querySelector('[data-asset-report]'), null); assert.equal(root.hidden, false);
    assert.equal(search.value, 'GUINCHO'); assert.match(root.querySelector('.rg-pagination').textContent, /Página 2 de 2/);
    assert.equal(root.scrollTop, 440); assert.equal(doc.activeElement, trigger);
  }
});

test('anexos e editar permanecem independentes do relatório no cadastro', async t => {
  const dom = domFor(t), doc = dom.window.document; let reads = 0, attachments = 0, edits = 0;
  const gallery = createRegistrationGallery({ document: doc, kind: 'asset', data: {
    async loadSnapshot() { return { rows: [{ id: '96', hasAttachments: true, fields: { IMOBILIZADO: 'GUINCHO' } }] }; },
    async loadAssetReport() { reads++; return report(); },
    async listAttachments() { attachments++; return []; }, async downloadAttachment() {},
    async loadEditor() { edits++; throw new Error('Teste de editor'); },
  } }); t.after(() => gallery.destroy()); await gallery.open();
  await tick(); const beforeAttachments = attachments;
  doc.querySelector('[data-action="registration-attachments"]').click(); await tick();
  assert.equal(attachments, beforeAttachments + 1); assert.equal(reads, 0);
  doc.querySelector('[data-gallery-action="edit"]').click(); await tick();
  assert.equal(edits, 1); assert.equal(reads, 0); assert.equal(doc.querySelector('[data-asset-report]'), null);
});

test('nome e ID do cadastro formam um botão aparente, com os demais dados fora do alvo de clique', async t => {
  const dom = domFor(t), doc = dom.window.document, calls = [];
  const gallery = createRegistrationGallery({ document: doc, kind: 'asset', data: {
    async loadSnapshot() { return { rows: [{ id: '96', hasAttachments: false, fields: { IMOBILIZADO: 'GUINCHO ELÉTRICO COLUNA 350 KG' } }] }; },
    async loadAssetReport(id) { calls.push(id); return report(id); },
  } }); t.after(() => gallery.destroy()); await gallery.open();
  const button = doc.querySelector('.rg-asset-heading button[data-asset-report-trigger]');
  assert.ok(button, 'O nome deve ser um botão nativo no cabeçalho');
  assert.match(button.textContent, /GUINCHO ELÉTRICO COLUNA 350 KG/); assert.match(button.textContent, /ID 96/);
  assert.match(button.textContent, /Ver depreciações/); assert.equal(button.type, 'button');
  assert.equal(doc.querySelector('.rg-row-main').hasAttribute('role'), false);
  doc.querySelector('.rg-asset-values').click(); await tick(); assert.deepEqual(calls, []);
  button.querySelector('.rg-row-title').click(); await tick(); assert.deepEqual(calls, ['96']);
  assert.ok(doc.querySelector('[data-asset-report="96"]'));
});

test('título do lançamento é um botão em bloco e abre o bem vinculado, mantendo os detalhes fora do clique', async t => {
  const dom = domFor(t), doc = dom.window.document, calls = [];
  const gallery = createRegistrationGallery({ document: doc, kind: 'assetLaunches', data: {
    async loadSnapshot() { return { rows: [{ id: '275', fields: { IMOBILIZADO: 'GUINCHO DE TESTE', 'ID IMOBILIZADO': 96, FILIAL: 'FILIAL TESTE' } }] }; },
    async loadAssetReport(id) { calls.push(id); return report(id); },
  } }); t.after(() => gallery.destroy()); await gallery.open();
  const button = doc.querySelector('.rg-document-heading button.rg-asset-report-open[data-asset-report-trigger]');
  assert.ok(button, 'O título dos lançamentos deve usar o mesmo botão destacado do cadastro');
  assert.equal(button.type, 'button'); assert.match(button.textContent, /GUINCHO DE TESTE/);
  assert.match(button.textContent, /ID 275/); assert.match(button.textContent, /Ver cadastro e depreciações/);
  assert.equal(doc.querySelector('.gallery-record-main').hasAttribute('role'), false);
  doc.querySelector('.rg-details').click(); await tick(); assert.deepEqual(calls, []);
  button.querySelector('.rg-row-title').click(); await tick(); assert.deepEqual(calls, ['96']);
  assert.ok(doc.querySelector('[data-asset-report="96"]'));
});

test('Tab alcança o cartão nas duas galerias e sua ativação abre o relatório correto', async t => {
  for (const kind of ['asset', 'assetLaunches']) {
    const dom = domFor(t), doc = dom.window.document, calls = [];
    const gallery = createRegistrationGallery({ document: doc, kind, data: {
      async loadSnapshot() { return { rows: [{ id: kind === 'asset' ? '96' : '275', hasAttachments: false, fields: { IMOBILIZADO: 'GUINCHO', 'ID IMOBILIZADO': 96 } }] }; },
      async loadAssetReport(id) { calls.push(id); return report(id); },
    } }); t.after(() => gallery.destroy()); await gallery.open();
    const previous = doc.querySelector('summary'); previous.focus();
    const trigger = doc.querySelector('[data-asset-report-trigger]');
    for (let tabs = 0; tabs < 20 && doc.activeElement !== trigger; tabs++) doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(doc.activeElement, trigger);
    trigger.click(); await tick();
    assert.deepEqual(calls, ['96']); assert.ok(doc.querySelector('[data-asset-report="96"]'));
  }
});

test('modal cancela respostas antigas, refaz o mesmo bem após erro e não confunde ausência de histórico com falha', async t => {
  const dom = domFor(t), doc = dom.window.document, host = doc.querySelector('#host'), background = doc.querySelector('#background'), trigger = doc.querySelector('#trigger');
  const pending = [], calls = [];
  const modal = createAssetReportView({ document: doc, host, background: [background], loadReport(id, options) {
    calls.push({ id, signal: options.signal }); return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } }); t.after(() => modal.destroy());
  modal.open('96', trigger); assert.equal(background.inert, true);
  modal.open('95', trigger); assert.equal(calls[0].signal.aborted, true);
  pending[0].resolve(report('96')); await tick(); assert.equal(doc.querySelector('[data-asset-report="96"]'), null);
  pending[1].reject(new Error('Falha na página 2')); await tick();
  assert.ok(doc.querySelector('[role="alert"]')); assert.equal(doc.querySelector('[data-asset-report-empty]'), null);
  doc.querySelector('[data-action="retry-asset-report"]').click();
  assert.equal(calls.at(-1).id, '95'); const empty = report('95'); empty.history = []; empty.historyTotal = 0;
  pending[2].resolve(empty); await tick(); assert.match(doc.querySelector('[data-asset-report-empty]').textContent, /Nenhuma depreciação/);
  modal.close(); assert.equal(background.inert, false); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  modal.open('96', trigger); modal.close(); assert.equal(calls.at(-1).signal.aborted, true);
  pending[3].resolve(report()); await tick(); assert.equal(doc.querySelector('[data-asset-report]'), null);
});

test('timeout permite tentar novamente; Escape e Tab ficam no relatório; resposta de outro bem é recusada', async t => {
  const dom = domFor(t), doc = dom.window.document, host = doc.querySelector('#host'), trigger = doc.querySelector('#trigger');
  const modal = createAssetReportView({ document: doc, host, background: [], timeoutMs: 15, loadReport: () => new Promise(() => {}) }); t.after(() => modal.destroy());
  modal.open('96', trigger); await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(doc.querySelector('[role="alert"]').textContent, /demorou/);
  const close = doc.querySelector('[data-action="close-asset-report"]'), retry = doc.querySelector('[data-action="retry-asset-report"]');
  retry.focus(); retry.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(doc.activeElement, close);
  close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); assert.equal(doc.activeElement, retry);
  modal.close();
  const wrong = createAssetReportView({ document: doc, host, background: [], loadReport: async () => report('95') }); t.after(() => wrong.destroy());
  wrong.open('96', trigger); await tick(); assert.ok(doc.querySelector('[role="alert"]')); assert.equal(doc.querySelector('[data-asset-history-row]'), null);
});

test('fechar ou atualizar a galeria aborta o relatório pendente', async t => {
  const dom = domFor(t), doc = dom.window.document; const signals = [];
  const gallery = createRegistrationGallery({ document: doc, kind: 'assetLaunches', data: {
    async loadSnapshot() { return { rows: [{ id: '275', fields: { IMOBILIZADO: 'GUINCHO', 'ID IMOBILIZADO': 96 } }] }; },
    loadAssetReport(_id, { signal }) { signals.push(signal); return new Promise(() => {}); },
  } }); t.after(() => gallery.destroy()); await gallery.open();
  doc.querySelector('[data-asset-report-trigger]').click(); gallery.close(); assert.equal(signals[0].aborted, true);
  await gallery.open(); doc.querySelector('[data-asset-report-trigger]').click(); await gallery.open(); assert.equal(signals[1].aborted, true);
});

 test('cadastro mostra somente campos solicitados, compra seguida do residual acumulado e status destacados', async t => {
  for (const status of ['ATIVO', 'INATIVO', 'PENDENTE']) {
    const dom = domFor(t), doc = dom.window.document, result = report();
    result.asset.details.push(
      { name: 'COMPRA', label: 'Valor compra', value: '4.338,02', type: 'currency' },
      { name: 'STATUS', label: 'STATUS', value: status },
      { name: 'TITLE', label: 'Título', value: 'NÃO MOSTRAR' },
      { name: 'Created', label: 'Criado', value: '2025-01-01' },
      { name: 'FORNECEDOR', label: 'FORNECEDOR', value: '<img src=x onerror=alert(1)>' },
    );
    result.asset.details.find(f => f.name === 'VALORRESIDUAL').value = '3.015,51';
    const view = createAssetReportView({ document: doc, host: doc.querySelector('#host'), loadReport: async () => result });
    t.after(() => view.destroy()); view.open('96', doc.querySelector('#trigger')); await tick();
    const registration = doc.querySelector('[data-asset-registration]');
    assert.equal(registration.querySelectorAll('[data-asset-field]').length, 13);
    assert.doesNotMatch(registration.textContent, /FUNÇÃO|Título|Criado|NÃO MOSTRAR/);
    const purchase = registration.querySelector('[data-asset-field="COMPRA"]');
    assert.equal(purchase.nextElementSibling.dataset.assetField, 'VALORRESIDUAL');
    assert.equal(purchase.nextElementSibling.querySelector('dt').textContent, 'Valor residual');
    assert.match(purchase.nextElementSibling.querySelector('dd').textContent, /3\.015,51\s+\(30,5% depreciado\)/);
    const badge = registration.querySelector('[data-asset-field="STATUS"] dd span');
    assert.equal(badge.textContent, status);
    assert.equal(badge.classList.contains('asset-report-badge--active'), status === 'ATIVO');
    assert.equal(badge.classList.contains('asset-report-badge--inactive'), status === 'INATIVO');
    assert.equal(registration.querySelector('img'), null);
    assert.match(registration.textContent, /<img src=x/);
  }
});

test('percentual acumulado conserva residual zero e não inventa percentual com compra ausente ou zero', async t => {
  for (const [purchase, residual, expected] of [[100, 100, '0,0%'], [100, 0, '100,0%'], [100, 75.54, '24,5%'], [0, 0, null], [null, 5, null], [100, null, null]]) {
    const dom = domFor(t), doc = dom.window.document, result = report();
    result.asset.details.push({ name: 'COMPRA', label: 'Valor compra', value: purchase, type: 'currency' });
    result.asset.details.find(f => f.name === 'VALORRESIDUAL').value = residual;
    const view = createAssetReportView({ document: doc, host: doc.querySelector('#host'), loadReport: async () => result });
    t.after(() => view.destroy()); view.open('96'); await tick();
    const field = doc.querySelector('[data-asset-field="VALORRESIDUAL"]');
    assert.equal(field.querySelector('dt').textContent, 'Valor residual');
    const value = field.querySelector('dd').textContent;
    if (expected) assert.ok(value.includes(expected), value); else assert.doesNotMatch(value, /%|NaN|Infinity/);
  }
});

test('faixas do percentual depreciado respeitam limites e ficam após o valor residual', async t => {
  for (const [percent, color] of [[0,'green'], [9.9,'green'], [10,'yellow'], [24.9,'yellow'], [25,'orange'], [50,'orange'], [50.1,'red'], [100,'red']]) {
    const dom=domFor(t), doc=dom.window.document, result=report();
    result.asset.details.push({name:'COMPRA',label:'Valor compra',value:1000,type:'currency'});
    result.asset.details.find(f=>f.name==='VALORRESIDUAL').value=1000-percent*10;
    const view=createAssetReportView({document:doc,host:doc.querySelector('#host'),loadReport:async()=>result});
    t.after(()=>view.destroy());view.open('96');await tick();
    const field=doc.querySelector('[data-asset-field="VALORRESIDUAL"]');
    const badge=field.querySelector('[data-depreciated-percent]');
    assert.equal(field.querySelector('dt').textContent,'Valor residual');
    assert.ok(badge,`percentual ausente em ${percent}%`);
    assert.ok(badge.classList.contains(`asset-report-depreciated--${color}`),`${percent}% deve ser ${color}`);
    assert.match(field.querySelector('dd').textContent,/^R\$\s.*\s\(\d/);
    assert.match(badge.textContent,/% depreciado\)$/);
  }
});

test('valores monetários decimais e percentuais muito próximos dos limites não contradizem a cor exibida', async t => {
  for (const [purchase,residual,shown,color] of [
    [0.3,0.27,'10,0','yellow'], [0.36,0.27,'25,0','orange'],
    [10000,9001,'9,99','green'], [10000,7501,'24,99','yellow'], [10000,4996,'50,04','red'],
  ]) {
    const dom=domFor(t),doc=dom.window.document,result=report();
    result.asset.details.push({name:'COMPRA',label:'Valor compra',value:purchase,type:'currency'});
    result.asset.details.find(f=>f.name==='VALORRESIDUAL').value=residual;
    const view=createAssetReportView({document:doc,host:doc.querySelector('#host'),loadReport:async()=>result});
    t.after(()=>view.destroy());view.open('96');await tick();
    const badge=doc.querySelector('[data-depreciated-percent]');
    assert.equal(badge.textContent,`(${shown}% depreciado)`);
    assert.ok(badge.classList.contains(`asset-report-depreciated--${color}`));
  }
});

test('valor residual abre gráfico cronológico com valores registrados e fecha voltando ao cartão', async t => {
  const dom=domFor(t), doc=dom.window.document, result=report();
  result.asset.details.push({name:'COMPRA',label:'Valor compra',value:5000,type:'currency'});
  const view=createAssetReportView({document:doc,host:doc.querySelector('#host'),loadReport:async()=>result});
  t.after(()=>view.destroy()); view.open('96',doc.querySelector('#trigger')); await tick();
  const field=doc.querySelector('[data-asset-field="VALORRESIDUAL"]');
  const trigger=field.querySelector('button[data-action="open-depreciation-chart"]');
  assert.ok(trigger); assert.match(trigger.textContent,/gráfico/i);
  trigger.click();
  const chart=doc.querySelector('[data-depreciation-chart]');
  assert.ok(chart); assert.equal(chart.getAttribute('role'),'dialog');
  assert.ok(chart.querySelector('svg'));
  assert.deepEqual([...chart.querySelectorAll('[data-chart-point]')].map(p=>[p.dataset.date,p.dataset.value]),[
    ['2025-01-01','5000'],['2026-10-01','4870'],['2026-11-01','4723.9']
  ]);
  assert.match(chart.textContent,/01\/11\/2026/); assert.match(chart.textContent,/4\.723,90/);
  chart.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(doc.querySelector('[data-depreciation-chart]'),null);
  assert.ok(doc.querySelector('[data-asset-report]')); assert.equal(doc.activeElement,trigger);
});

test('gráfico vazio explica a ausência de depreciações sem criar histórico', async t => {
  const dom=domFor(t), doc=dom.window.document, result=report(); result.history=[]; result.historyTotal=0;
  const view=createAssetReportView({document:doc,host:doc.querySelector('#host'),loadReport:async()=>result});
  t.after(()=>view.destroy()); view.open('96'); await tick();
  doc.querySelector('[data-action="open-depreciation-chart"]').click();
  const chart=doc.querySelector('[data-depreciation-chart]');
  assert.match(chart.textContent,/Nenhuma depreciação registrada/i);
  assert.equal(chart.querySelectorAll('[data-chart-point]').length,0);
});

test('gráfico conserva o valor registrado mesmo quando aumenta e não antecipa compra posterior', async t => {
  const dom=domFor(t), doc=dom.window.document, result=report();
  result.asset.details.push({name:'COMPRA',label:'Valor compra',value:5000,type:'currency'});
  result.asset.details.find(field=>field.name==='DATACOMPRA').value='2026-12-01';
  result.history[0].fields['VALOR RESIDUAL']=4900;
  const view=createAssetReportView({document:doc,host:doc.querySelector('#host'),loadReport:async()=>result});
  t.after(()=>view.destroy()); view.open('96'); await tick();
  doc.querySelector('[data-action="open-depreciation-chart"]').click();
  const chart=doc.querySelector('[data-depreciation-chart]');
  assert.deepEqual([...chart.querySelectorAll('[data-chart-point]')].map(p=>p.dataset.value),['4870','4900']);
  assert.doesNotMatch(chart.textContent,/Compra/);
});
