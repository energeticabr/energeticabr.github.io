import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createPaymentLedgerView } from '../src/ui/payment-ledger-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';

const css=await readFile(new URL('../src/ui/payment-ledger.css',import.meta.url),'utf8');
const base={paymentDate:'2026-10-02',supplier:'Alfa',branch:'Xavante',account:'Caixa',order:'358',
  product:'Serviço',description:'Descrição <b>literal</b>',disbursement:'SIM',unit:0.1,quantity:1,freight:0,total:0.1};
function setup(t,launches,loader=async()=>({launches})){
  let loads=0;
  const dom=new JSDOM('<main id="app"><button>Relatório</button></main>');
  const style=dom.window.document.createElement('style');style.textContent=css;dom.window.document.head.append(style);
  dom.window.matchMedia=()=>({matches:false});
  const view=createPaymentLedgerView({document:dom.window.document,data:{async loadPaymentsSnapshot(options){loads++;return loader(options);}}});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,get loads(){return loads;}};
}
const tableOf=snapshot=>snapshot.pages[0].blocks.find(block=>block.type==='table');
const text=cell=>cell.runs.map(run=>run.text).join('');
const ids=snapshot=>tableOf(snapshot).rows.slice(1).map(row=>text(row.cells[2]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Break: printing grows the live 200-row batch, replaces its scroll anchor,
// fetches again, or captures only the visible rows rather than all 1201 items.
test('capturePrint exports 1201 entries while preserving the same 200 live rows, focus and scroll',async t=>{
  const launches=Array.from({length:1201},(_,index)=>({...base,id:String(index+1),...(index===1200?{total:1.005}:{} )}));
  const f=setup(t,launches);await f.view.open();
  assert.equal(typeof f.view.capturePrint,'function');
  const body=f.root.querySelector('tbody'),scroll=f.root.querySelector('.pl-table-scroll');
  const first=body.firstElementChild,before=body.innerHTML,loadStatus=f.root.querySelector('.pl-load-status').textContent;
  scroll.scrollTop=123;const focus=f.root.querySelector('.sfs-trigger[aria-label="FORNECEDOR"]');focus.focus();
  assert.equal(body.rows.length,200);
  const observer=new f.dom.window.MutationObserver(()=>{});observer.observe(f.root,{subtree:true,childList:true,attributes:true,characterData:true});
  t.after(()=>observer.disconnect());
  const create=f.dom.window.document.createElement.bind(f.dom.window.document),constructed=[];
  f.dom.window.document.createElement=(tag,...args)=>{if(['TR','TD'].includes(String(tag).toUpperCase()))constructed.push(tag);return create(tag,...args);};
  const snapshot=f.view.capturePrint({title:'Relatório de pagamentos'});
  assert.equal(snapshot?.then,undefined,'capturePrint is synchronous');
  assert.deepEqual(observer.takeRecords(),[],'capture must not mutate even temporary live rows');
  assert.deepEqual(constructed,[],'complete printing must not construct row/cell DOM');
  assert.equal(body.rows.length,200);assert.equal(body.firstElementChild,first);assert.equal(body.innerHTML,before);
  assert.equal(scroll.scrollTop,123);assert.equal(f.dom.window.document.activeElement,focus);
  assert.equal(f.root.querySelector('.pl-load-status').textContent,loadStatus);assert.equal(f.loads,1);
  assert.equal(snapshot.title,'Relatório de pagamentos');assert.equal(snapshot.pages.length,1);
  const table=tableOf(snapshot);assert.equal(table.widths.length,12);assert.equal(table.rows.length,1202);
  assert.ok(table.rows.every(row=>row.cells.length===12));assert.ok(table.rows[0].header);
  assert.deepEqual(ids(snapshot),Array.from({length:1201},(_,index)=>String(1201-index)));
  assert.equal(text(table.rows[1].cells[10]),'R$ 1,01');
  assert.equal(text(table.rows.at(-1).cells[11]),'R$ 121,01');
  assert.deepEqual(table.rows.at(-1).cells[11].runs[0].color,[1,0,0]);assert.ok(table.rows.at(-1).cells[11].runs[0].bold);
  assert.equal(text(table.rows.at(-1).cells[6]),'Serviço  (Descrição <b>literal</b>)');
  assert.deepEqual(table.rows.at(-1).cells[6].runs.map(run=>run.bold),[true,false]);
  assert.equal(f.root.querySelector('tbody b'),null);
  assert.ok(snapshot.filters.some(filter=>filter.label==='Data inicial'&&filter.value==='Desde o início'));
  assert.ok(snapshot.filters.some(filter=>filter.label==='Data final'&&filter.value==='Até o fim'));
  const second=f.view.capturePrint({title:'Relatório de pagamentos'});assert.deepEqual(second,snapshot);assert.equal(f.loads,1);
});

// Break: the print path uses purchase dates, ignores a selected dimension,
// truncates the filtered tail, changes descending order, or resets day colors.
test('capturePrint preserves all seven filters, inclusive payment dates, full totals and alternating days',async t=>{
  const matches=Array.from({length:1200},(_,index)=>({...base,id:String(index+1),paymentDate:index<600?'2026-10-02':'2026-10-03',
    date:'2020-01-01',total:index<600?0.2:0.1}));
  const excluded=[{paymentDate:''},{paymentDate:'2026-10-01'},{paymentDate:'2026-10-04'},
    {branch:'Outra'},{supplier:'Beta'},{product:'Outro'},{order:'999'},{disbursement:'NÃO'}].map((changes,index)=>({...base,id:String(2000+index),total:999,...changes}));
  const f=setup(t,[...excluded,...matches.reverse()]);await f.view.open();
  assert.equal(typeof f.view.capturePrint,'function');
  for(const [name,value] of [['startDate','2026-10-02'],['endDate','2026-10-03'],['branch','Xavante'],['supplier','Alfa'],['product','Serviço'],['order','358'],['disbursement','SIM']]){
    const control=f.root.querySelector(`[name=${name}]`);control.value=value;control.dispatchEvent(new f.dom.window.Event('change'));await tick();
  }
  assert.equal(f.root.querySelectorAll('tbody tr').length,200);const reads=f.loads;
  const snapshot=f.view.capturePrint(),table=tableOf(snapshot);
  assert.equal(f.loads,reads);assert.equal(f.root.querySelectorAll('tbody tr').length,200);
  assert.deepEqual(ids(snapshot),Array.from({length:1200},(_,index)=>String(1200-index)));
  assert.deepEqual(snapshot.filters,[{label:'Data inicial',value:'02/10/2026'},{label:'Data final',value:'03/10/2026'},
    {label:'FILIAL',value:'Xavante'},{label:'ID PEDIDO',value:'358'},{label:'PRODUTO',value:'Serviço'},
    {label:'FORNECEDOR',value:'Alfa'},{label:'DESEMBOLSO',value:'SIM'}]);
  assert.equal(text(table.rows[1].cells[0]),'03/10/2026');assert.equal(text(table.rows[600].cells[0]),'03/10/2026');
  assert.equal(text(table.rows[601].cells[0]),'02/10/2026');assert.equal(text(table.rows.at(-1).cells[0]),'02/10/2026');
  assert.equal(text(table.rows[600].cells[11]),'R$ 60,00');assert.equal(text(table.rows.at(-1).cells[11]),'R$ 120,00');
  assert.deepEqual(table.rows[600].cells[0].background,[230/255,240/255,1]);assert.deepEqual(table.rows[601].cells[0].background,[1,1,1]);
});

// Independent oracle: the existing DOM capture contract, including row-span
// expansion, widths, all run styles, incomplete amounts and literal whitespace.
test('capturePrint matches captureFilteredReport for every column and styled run across groups beyond the visible batch',async t=>{
  const launches=Array.from({length:251},(_,index)=>({...base,id:String(index+1),paymentDate:index<130?'2026-10-02':'2026-10-03',
    supplier:index%3===0?'Beta':'Alfa',branch:index%2?'Xavante':'Filial 2',account:index%4?'Caixa':'Banco',order:index%5?'358':'2',
    product:index%2?'Serviço':'<script>Texto literal</script>',description:index%3?'Descrição\n  completa & literal':'',
    quantity:index%6?0.12345:null,freight:index%7?1.25:null,total:index%11?10.075:null}));
  const actual=setup(t,launches),oracle=setup(t,launches);await actual.view.open();await oracle.view.open();
  assert.equal(typeof actual.view.capturePrint,'function');
  const restore=oracle.view.preparePrint();
  const expected=captureFilteredReport(oracle.root,{title:'Pagamentos completos'});restore();
  assert.deepEqual(actual.view.capturePrint({title:'Pagamentos completos'}),expected);
  assert.equal(actual.root.querySelectorAll('tbody tr').length,200);
});

test('capturePrint rejects closed, loading, failed and invalid-date states and captures empty filters without stale data',async t=>{
  const closed=setup(t,[]);assert.equal(typeof closed.view.capturePrint,'function');assert.throws(()=>closed.view.capturePrint(),/carregamento/);
  let finish;const pending=setup(t,[],()=>new Promise(resolve=>{finish=resolve;}));const opened=pending.view.open();
  assert.throws(()=>pending.view.capturePrint(),/carregamento/);finish({launches:[{...base,id:'1'}]});await opened;
  pending.view.close();assert.throws(()=>pending.view.capturePrint(),/carregamento/);
  const failed=setup(t,[],async()=>{throw new Error('Falha na consulta');});await failed.view.open();assert.throws(()=>failed.view.capturePrint(),/Atualizar/);
  const invalid=setup(t,[{...base,id:'1'}]);await invalid.view.open();
  const date=invalid.root.querySelector('[data-date-display=startDate]');date.value='31/02/2026';date.dispatchEvent(new invalid.dom.window.Event('change'));
  assert.throws(()=>invalid.view.capturePrint(),/datas|carregar/);
  const empty=setup(t,[]);await empty.view.open();const expected=captureFilteredReport(empty.root,{title:'Relatório de pagamentos'});
  assert.deepEqual(empty.view.capturePrint(),expected);assert.equal(tableOf(expected).rows.length,1);assert.equal(empty.loads,1);
});
