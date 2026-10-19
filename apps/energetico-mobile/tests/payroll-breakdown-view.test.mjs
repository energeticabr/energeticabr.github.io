import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { File } from 'node:buffer';
import { createPayrollBreakdownView } from '../src/ui/payroll-breakdown-view.js';
import { validatePayrollBreakdown } from '../src/chat/payroll-breakdown.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createPayrollBreakdownAttachments } from '../src/chat/payroll-breakdown-attachments.js';

function harness(options = {}) {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' }), documentRef = dom.window.document;
  let posts = 0, posted, fail = false;
  const supplier = { id: '7', label: 'FORNECEDOR TESTE', branch: '004 - EDIFÍCIO XAVANTE', profession: 'PEDREIRO' };
  const data = { loadSuppliers: async () => [supplier, { ...supplier, id: '8', label: 'OUTRO FORNECEDOR' }], post: async (draft, progress, changed) => {
    posts++; posted = { ...draft, lines:draft.lines.map(line=>({...line})) }; const summary = validatePayrollBreakdown(draft); progress.signature = JSON.stringify(summary); changed();
    if (fail) throw new Error('Rede indisponível');
    return { ...summary, lines: summary.lines.map((line, index) => ({ ...line, id: String(index + 10), parentId: String(index + 20) })) };
  } };
  const view = createPayrollBreakdownView({ data, documentRef, root: documentRef.querySelector('main'), sessionKey: 'account', storage: dom.window.localStorage, now: () => new Date('2026-10-01T12:00:00Z'), ...options });
  const click = async selector => {
    documentRef.querySelector(selector).click(); await new Promise(resolve => setImmediate(resolve));
    const footer=documentRef.querySelector('.payroll-breakdown-footer');
    if(footer?.hidden) await new Promise(resolve=>{const observer=new dom.window.MutationObserver(()=>{if(!footer.hidden){observer.disconnect();resolve();}});observer.observe(footer,{attributes:true,attributeFilter:['hidden']});});
  };
  const input = (selector, value) => { const node = documentRef.querySelector(selector); node.value = value; node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  return { dom, doc: documentRef, data, view, click, input, get posts() { return posts; }, get posted() { return posted; }, fail: () => { fail = true; }, recover: () => { fail = false; } };
}

test('fluxo filtra fornecedor, oferece sextas e fim do mês e só submete após conferência', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); }); await h.view.open();
  h.input('[type=search]', 'TESTE'); assert.equal(h.doc.querySelector('[data-breakdown-supplier="8"]').hidden, true);
  await h.click('[data-breakdown-supplier="7"]'); assert.equal(h.doc.querySelector('[type=month]').value, '2026-10');
  await h.click('[data-breakdown-next]'); assert.equal(h.doc.querySelectorAll('[data-breakdown-date]').length, 6);
  assert.equal(h.doc.querySelector('[data-breakdown-quantity="2026-10-02:salary"]').value, '1');
  h.input('[data-breakdown-quantity="2026-10-02:salary"]', '5'); h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  h.input('[data-breakdown-value="2026-10-31:thirteenth"]', '50');
  assert.equal(h.doc.querySelectorAll('.payroll-breakdown-rubric--selected').length, 2);
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent, /550,00/);
  await h.click('[data-breakdown-next]'); assert.equal(h.posts, 0);
  assert.equal(h.doc.querySelectorAll('.payroll-breakdown-review article').length, 2);
  assert.match(h.doc.querySelector('[aria-label="Totais por rubrica"]').textContent, /Salário.*500,00.*13º salário.*50,00.*Total geral.*550,00/s);
  await h.click('[data-breakdown-edit]'); assert.equal(h.doc.querySelector('[data-breakdown-quantity="2026-10-02:salary"]').value, '5');
  await h.click('[data-breakdown-next]'); await h.click('[data-breakdown-submit]'); assert.equal(h.posts, 1);
  assert.match(h.doc.body.textContent, /Provisões criadas com sucesso/); assert.equal(h.dom.window.localStorage.length, 0);
  await h.click('[data-breakdown-done]'); assert.equal(h.dom.window.localStorage.length, 0);
  await h.view.open(); assert.ok(h.doc.querySelector('[data-breakdown-supplier="7"]'));
  assert.equal(h.doc.querySelector('[data-breakdown-submit]'), null);
});

test('trocar mês recalcula o calendário e voltar do calendário retorna à pergunta do mês', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); }); await h.view.open(); await h.click('[data-breakdown-supplier="7"]');
  h.input('[type=month]', ''); await h.click('[data-breakdown-next]'); assert.equal(h.doc.querySelector('[role=alert]').hidden, false);
  h.input('[type=month]', '2024-02'); await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelector('[role=alert]').hidden, true);
  assert.ok(h.doc.querySelector('[data-breakdown-date="2024-02-29"]')); assert.equal(h.doc.querySelectorAll('[data-breakdown-date]').length, 5);
  await h.click('[aria-label="Voltar"]'); assert.equal(h.doc.querySelector('[type=month]').value, '2024-02');
  h.input('[type=month]', '2026-07'); await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelectorAll('[data-breakdown-date="2026-07-31"]').length, 1);
  await h.click('[data-breakdown-next]'); assert.match(h.doc.querySelector('[role=alert]').textContent, /pelo menos/);
});

test('total recolhido abre rubricas somadas entre datas e atualiza sem fechar ou postar', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  const panel = h.doc.querySelector('details.payroll-breakdown-totals');
  assert.ok(panel, 'total deve ser expansível'); assert.equal(panel.open, false);
  h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  h.input('[data-breakdown-quantity="2026-10-09:salary"]', '2');
  h.input('[data-breakdown-value="2026-10-09:salary"]', '50');
  h.input('[data-breakdown-value="2026-10-02:award"]', '25,50');
  assert.match(panel.querySelector('summary').textContent, /Total geral.*225,50/);
  await h.click('.payroll-breakdown-totals > summary'); assert.equal(panel.open, true);
  const table = () => panel.querySelector('table').textContent;
  assert.match(table(), /Salário.*200,00.*Prêmio.*25,50/s);
  h.input('[data-breakdown-value="2026-10-09:salary"]', '75');
  assert.equal(panel.open, true); assert.match(table(), /Salário.*250,00/s);
  h.input('[data-breakdown-value="2026-10-02:award"]', '');
  assert.match(table(), /Prêmio.*0,00/s); assert.match(panel.querySelector('summary').textContent, /250,00/);
  h.input('[data-breakdown-value="2026-10-02:salary"]', 'inválido');
  assert.match(panel.textContent, /confira os valores/i); assert.equal(panel.querySelector('table'), null);
  h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  assert.match(table(), /Salário.*250,00/s); assert.equal(panel.open, true); assert.equal(h.posts, 0);
  await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelector('details.payroll-breakdown-totals').open, false);
  await h.click('.payroll-breakdown-totals > summary'); assert.equal(h.posts, 0);
  await h.click('[data-breakdown-submit]');
  assert.equal(h.doc.querySelector('details.payroll-breakdown-totals').open, false);
  assert.match(h.doc.querySelector('.payroll-breakdown-totals summary').textContent, /250,00/);
});

test('falha no envio mantém o lote para retomada após recriar a tela e impede alteração', async t => {
  const h = harness(); let restored; t.after(() => { h.view.destroy(); restored?.destroy(); h.dom.window.close(); });
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  h.input('[data-breakdown-value="2026-10-02:salary"]', '10'); await h.click('[data-breakdown-next]'); h.fail(); await h.click('[data-breakdown-submit]');
  assert.match(h.doc.querySelector('[role=alert]').textContent, /Rede/); assert.equal(h.dom.window.localStorage.length, 1);
  h.view.destroy(); h.recover();
  restored = createPayrollBreakdownView({ data: h.data, documentRef: h.doc, sessionKey: 'account', storage: h.dom.window.localStorage }); await restored.open();
  assert.equal(h.doc.querySelector('[aria-label="Voltar"]').disabled, true); assert.equal(h.doc.querySelector('[data-breakdown-submit]').textContent, 'Retomar envio');
  await h.click('[data-breakdown-submit]'); assert.equal(h.posts, 2); assert.match(h.doc.body.textContent, /Provisões criadas com sucesso/);
});

test('menu de provisões exibe atalho somente na pergunta atual', () => {
  const menu = { id: 'menu', role: 'assistant', type: 'poll', question: 'QUAL OPERAÇÃO DE PROVISÃO?', options: [{ id: 'action_payment', label: 'CRIAR UMA PROVISÃO' }, { id: 'action_recurring_expense', label: 'CRIAR UMA DESPESA RECORRENTE' }] };
  const state = { sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', pendingFiles: [], messages: [menu] };
  assert.match(renderChatMarkup(state), /DESDOBRAR FOLHA DE PGTO/);
  const dom = new JSDOM(renderChatMarkup({ ...state, messages: [menu, { id: 'next', role: 'assistant', type: 'poll', question: 'Fornecedor?', options: [] }] }));
  assert.equal(dom.window.document.querySelector('[data-reply-id="action_payroll_provision_breakdown"]'), null); dom.window.close();
});

test('PAGO mostra valores da folha selecionada em cada rubrica e no total', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); });
  const requests = [];
  h.data.loadPayrollContext = async (supplier, month) => { requests.push([supplier.id, month]); return { sheetId: '19', paid: { salary: 300, meal: 50 }, paidTotal: 350 }; };
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  const table = h.doc.querySelector('[aria-label="Totais por rubrica"]');
  assert.deepEqual([...table.querySelectorAll('thead th')].map(th => th.textContent), ['Rubrica','PREVISTO','PAGO','TOTAL']);
  const salary = [...table.querySelectorAll('tbody tr')].find(row => row.textContent.startsWith('Salário'));
  assert.match(salary.cells[1].textContent, /100,00/); assert.match(salary.cells[2].textContent, /300,00/);
  assert.match(salary.cells[3].textContent, /400,00/);
  assert.match(table.querySelector('tbody tr:last-child').cells[2].textContent, /350,00/);
  assert.match(table.querySelector('tbody tr:last-child').cells[3].textContent, /450,00/);
  h.input('[data-breakdown-value="2026-10-02:salary"]', '100,15');
  assert.match(h.doc.querySelector('[aria-label="Totais por rubrica"] tbody tr:last-child td:last-child')?.textContent || '', /450,15/);
  assert.deepEqual(requests, [['7','2026-10']]);
});

test('cabeçalho geral inclui todo o pago mesmo sem novas provisões', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadPayrollContext = async () => ({ sheetId:'19',paid:{salary:3405.89,meal:477.72},paidTotal:3883.61,payments:[] });
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent, /3\.883,61/);
  h.input('[data-breakdown-value="2026-10-23:salary"]', '100');
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent, /3\.983,61/);
  assert.equal(h.posts,0);
});

test('semana passada mostra pagos distintos em cinza e sem campos financeiros editáveis', async t => {
  const h = harness({now:()=>new Date('2026-10-19T12:00:00Z')}); t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadPayrollContext = async () => ({sheetId:'19',paid:{salary:320},paidTotal:320,payments:[
    {id:'31',date:'2026-10-12',rubric:'salary',quantity:2,unitValue:100,total:200,launchId:'91'},
    {id:'32',date:'2026-10-18',rubric:'salary',quantity:1,unitValue:120,total:120,launchId:'92'},
  ]});
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  const week=h.doc.querySelector('[data-breakdown-date="2026-10-16"]');
  assert.ok(week.classList.contains('payroll-breakdown-date--past')); assert.equal(week.open,false);
  assert.match(week.querySelector('summary').textContent,/320,00/);
  await h.click('[data-breakdown-date="2026-10-16"] > summary');
  assert.equal(week.open,true);
  assert.equal(week.querySelectorAll('[data-breakdown-value],[data-breakdown-quantity]').length,0);
  assert.equal(week.querySelectorAll('[data-breakdown-payment]').length,2);
  assert.match(week.textContent,/12\/10\/2026/); assert.match(week.textContent,/18\/10\/2026/);
  assert.match(week.querySelector('[data-breakdown-payment="31"]').textContent,/2.*100,00/s);
  assert.match(week.querySelector('[data-breakdown-payment="32"]').textContent,/1.*120,00/s);
  assert.ok(h.doc.querySelector('[data-breakdown-value="2026-10-23:salary"]'));
  assert.equal(h.posts,0);
});

const receipt=()=>new File(['recibo'],'salario.pdf',{type:'application/pdf'});
function choose(h,selector,files) { const input=h.doc.querySelector(selector);assert.ok(input,'cada linha deve oferecer anexos');Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new h.dom.window.Event('change',{bubbles:true})); }
test('cada rubrica nova oferece anexos, preservados até a conferência sem postar antecipadamente',async t=>{
  const h=harness();t.after(()=>{h.view.destroy();h.dom.window.close();});
  await h.view.open();await h.click('[data-breakdown-supplier="7"]');await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelectorAll('[data-breakdown-files]').length,42);
  h.input('[data-breakdown-value="2026-10-02:salary"]','100');choose(h,'[data-breakdown-files="new:2026-10-02:salary"]',[receipt()]);
  await h.click('[data-breakdown-next]');assert.match(h.doc.querySelector('.payroll-breakdown-review').textContent,/salario.pdf/);assert.equal(h.posts,0);
  await h.click('[data-breakdown-submit]');assert.equal(h.posted.lines[0].files[0].name,'salario.pdf');
});
test('submeter anexos de linha paga usa apenas a operação de anexo e informa destinos',async t=>{
  const h=harness({now:()=>new Date('2026-10-19T12:00:00Z')});t.after(()=>{h.view.destroy();h.dom.window.close();});
  h.data.loadPayrollContext=async()=>({sheetId:'19',paid:{salary:100},paidTotal:100,payments:[{id:'31',date:'2026-10-12',rubric:'salary',quantity:1,unitValue:100,total:100}]});
  const requests=[];h.data.submitAttachments=async request=>{requests.push(request);return {status:'complete'};};
  await h.view.open();await h.click('[data-breakdown-supplier="7"]');await h.click('[data-breakdown-next]');
  await h.click('[data-breakdown-date="2026-10-16"] > summary');choose(h,'[data-breakdown-files="payment:31"]',[receipt()]);
  await h.click('[data-breakdown-attachments-submit="payment:31"]');assert.equal(requests.length,1);assert.equal(requests[0].paymentId,'31');assert.equal(requests[0].sheetId,'19');
  assert.match(h.doc.body.textContent,/Provisão.*lançamento.*pedido/s);assert.equal(h.posts,0);
});
test('retomada não serializa File e oferece reseleção sem desbloquear os valores financeiros',async t=>{
  const h=harness();let restored;t.after(()=>{h.view.destroy();restored?.destroy();h.dom.window.close();});
  h.data.post=async(draft,progress,changed)=>{progress.signature=JSON.stringify(validatePayrollBreakdown(draft));progress.attachments={'2026-10-02:salary':{manifest:[{name:'salario.pdf',size:6,sha256:'a'.repeat(64)}]}};changed();throw new Error('Falha de upload');};
  await h.view.open();await h.click('[data-breakdown-supplier="7"]');await h.click('[data-breakdown-next]');
  h.input('[data-breakdown-value="2026-10-02:salary"]','100');choose(h,'[data-breakdown-files="new:2026-10-02:salary"]',[receipt()]);
  await h.click('[data-breakdown-next]');await h.click('[data-breakdown-submit]');
  const saved=JSON.parse(h.dom.window.localStorage.getItem(h.dom.window.localStorage.key(0)));
  assert.equal('files' in saved.draft.lines[0],false);assert.equal(saved.progress.attachments['2026-10-02:salary'].manifest[0].name,'salario.pdf');
  h.view.destroy();restored=createPayrollBreakdownView({data:h.data,documentRef:h.doc,sessionKey:'account',storage:h.dom.window.localStorage});await restored.open();
  assert.match(h.doc.body.textContent,/selecione novamente/i);assert.ok(h.doc.querySelector('[data-breakdown-files="new:2026-10-02:salary"]'));assert.equal(h.doc.querySelector('[data-breakdown-value]'),null);
});
test('baixa ocorrida durante envio não duplica no total uma provisão que passou a paga',async t=>{
  const h=harness();t.after(()=>{h.view.destroy();h.dom.window.close();});let settled=false;
  h.data.loadPayrollContext=async()=>({sheetId:'19',paid:{salary:settled?100:0},paidTotal:settled?100:0,payments:settled?[{id:'31',date:'2026-10-02',rubric:'salary',quantity:1,unitValue:100,total:100}]:[]});
  h.data.post=async raw=>{settled=true;const summary=validatePayrollBreakdown(raw);return {...summary,lines:summary.lines.map(line=>({...line,id:'12',parentId:'20',paymentId:'31'}))};};
  await h.view.open();await h.click('[data-breakdown-supplier="7"]');await h.click('[data-breakdown-next]');h.input('[data-breakdown-value="2026-10-02:salary"]','100');await h.click('[data-breakdown-next]');await h.click('[data-breakdown-submit]');
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent,/100,00/);assert.doesNotMatch(h.doc.querySelector('.payroll-breakdown-total').textContent,/200,00/);
});

test('sucesso financeiro preserva diários históricos distintos até reselecionar os mesmos bytes após concluir e recriar',async t=>{
  const h=harness({now:()=>new Date('2026-10-19T12:00:00Z')});let restored;
  t.after(()=>{h.view.destroy();restored?.destroy();h.dom.window.close();});
  const paid=[31,32].map(id=>({id:String(id),date:'2026-10-12',rubric:'salary',quantity:1,unitValue:100,total:100}));
  h.data.loadPayrollContext=async()=>({sheetId:'19',paid:{salary:200},paidTotal:200,payments:paid});
  const owner={FORNECEDOR:'FORNECEDOR TESTE',FILIAL:'004 - EDIFÍCIO XAVANTE'};
  const rows={IDFOLHA:{19:owner},FOLHAPGTO:Object.fromEntries([31,32].map(id=>[id,{...owner,Title:`legacy-${id}`,IDFOLHA:'19',TIPOPGTO:'SALÁRIO',IDLANCAMENTO:String(id+60)}])),
    LANCAMENTOS:Object.fromEntries([91,92].map(id=>[id,{...owner,IDPGTOAGENDADO:'',AGRUPAR:'41'}])),NOTASPENDENTES:{41:owner}};
  const inventories=new Map();let fail=true,uploads=0;
  const repository={clearCache(){},resolveList:async(_s,n)=>({id:n[0],status:'resolved'}),getColumns:async(_s,l)=>Object.keys(Object.values(rows[l])[0]).map(name=>({name})),
    getItem:async(_s,l,id)=>({id,fields:rows[l][id]}),listAttachments:async(_s,l,id)=>[...(inventories.get(`${l}:${id}`)||new Map()).keys()].map(name=>({name})),
    downloadAttachment:async(_s,l,id,name)=>inventories.get(`${l}:${id}`).get(name),uploadAttachment:async(_s,l,id,f,name)=>{
      if(fail)throw new Error('Upload indisponível');uploads++;const inventory=inventories.get(`${l}:${id}`)||new Map();inventories.set(`${l}:${id}`,inventory);inventory.set(name,await f.arrayBuffer());}};
  h.data.submitAttachments=createPayrollBreakdownAttachments({repository}).submit;
  await h.view.open();await h.click('[data-breakdown-supplier="7"]');await h.click('[data-breakdown-next]');
  for(const id of [31,32]){choose(h,`[data-breakdown-files="payment:${id}"]`,[receipt()]);await h.click(`[data-breakdown-attachments-submit="payment:${id}"]`);assert.match(h.doc.querySelector('[role=alert]').textContent,/Upload/);}
  h.input('[data-breakdown-value="2026-10-23:salary"]','10');h.view.close();await h.view.open();
  assert.equal(h.doc.querySelector('[data-breakdown-value="2026-10-23:salary"]').value,'10','fechar antes de postar preserva o rascunho financeiro');
  await h.click('[data-breakdown-next]');await h.click('[data-breakdown-submit]');
  assert.match(h.doc.body.textContent,/Provisões criadas com sucesso/);assert.equal(h.dom.window.localStorage.length,1,'concluir financeiro não elimina anexos pendentes');
  const saved=JSON.parse(h.dom.window.localStorage.getItem(h.dom.window.localStorage.key(0)));
  assert.equal(saved.progress.signature,undefined);assert.equal(JSON.stringify(saved).includes('"files"'),false);
  await h.click('[data-breakdown-done]');await h.view.open();assert.match(h.doc.body.textContent,/Selecione novamente os mesmos arquivos/);
  h.view.destroy();fail=false;h.data.submitAttachments=createPayrollBreakdownAttachments({repository}).submit;
  restored=createPayrollBreakdownView({data:h.data,documentRef:h.doc,sessionKey:'account',storage:h.dom.window.localStorage,now:()=>new Date('2026-10-19T12:00:00Z')});await restored.open();
  assert.equal(h.doc.querySelector('[data-breakdown-value="2026-10-23:salary"]').value,'','provisões concluídas não voltam ao formulário');
  choose(h,'[data-breakdown-files="payment:31"]',[new File(['outros'],'salario.pdf',{type:'application/pdf'})]);await h.click('[data-breakdown-attachments-submit="payment:31"]');
  assert.match(h.doc.querySelector('[role=alert]').textContent,/mesmos arquivos/);assert.equal(uploads,0);
  choose(h,'[data-breakdown-files="payment:31"]',[receipt()]);await h.click('[data-breakdown-attachments-submit="payment:31"]');
  assert.equal(h.dom.window.localStorage.length,1,'segundo diário permanece independente');
  choose(h,'[data-breakdown-files="payment:32"]',[receipt()]);await h.click('[data-breakdown-attachments-submit="payment:32"]');
  assert.equal(h.dom.window.localStorage.length,0);assert.equal(uploads,3);assert.equal(h.posts,1);
});

for(const settled of [false,true]) test(`falha de atualização após sucesso torna total indisponível e oferece consulta sem repostar${settled?' com baixa concorrente':''}`,async t=>{
  const h=harness();t.after(()=>{h.view.destroy();h.dom.window.close();});let reads=0,posts=0;
  h.data.loadPayrollContext=async()=>{
    if(++reads===2)throw new Error('Consulta indisponível');
    const paid=settled&&reads>2?450:350;
    return {sheetId:'19',paid:{salary:paid},paidTotal:paid,payments:settled&&reads>2?[{id:'31',date:'2026-10-02',rubric:'salary',quantity:1,unitValue:100,total:100}]:[]};
  };
  h.data.post=async raw=>{posts++;const summary=validatePayrollBreakdown(raw);return {...summary,lines:summary.lines.map(line=>({...line,id:'12',parentId:'20',paymentId:'31'}))};};
  await h.view.open();await h.click('[data-breakdown-supplier="7"]');await h.click('[data-breakdown-next]');h.input('[data-breakdown-value="2026-10-02:salary"]','100');
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent,/450,00/);
  await h.click('[data-breakdown-next]');await h.click('[data-breakdown-submit]');
  assert.match(h.doc.body.textContent,/Provisões criadas com sucesso/);
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent,/indisponível/i);
  assert.match(h.doc.body.textContent,/não foi possível atualizar/i);
  assert.equal(h.doc.querySelector('.payroll-breakdown-total-row td:last-child').textContent,'—');
  await h.click('[data-breakdown-refresh]');assert.equal(posts,1);assert.equal(reads,3);
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent,/450,00/);
  assert.doesNotMatch(h.doc.querySelector('.payroll-breakdown-total').textContent,/550,00/);
});
