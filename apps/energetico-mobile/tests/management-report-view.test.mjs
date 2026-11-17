import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const { createManagementReportView } = await import('../src/ui/management-report-view.js').catch(()=>({}));
const row={id:'1',date:'2026-10-02',paymentDate:'2025-01-01',branch:'004 - EDIFÍCIO XAVANTE',supplier:'Alfa',product:'Cimento',stage:'Fundação',account:'Caixa',disbursement:'SIM',unit:10,quantity:2,freight:5,total:25};
function setup(t,loadSnapshot=async()=>({launches:[row],provisions:[],productTypes:[{product:'Cimento',expenseType:'MATERIAL'}]}),portrait=false){
  assert.equal(typeof createManagementReportView,'function');
  const dom=new JSDOM('<main id="app"><button>Resumo</button></main>');let vertical=portrait;
  dom.window.matchMedia=()=>({get matches(){return vertical;}});
  const view=createManagementReportView({document:dom.window.document,data:{loadSnapshot},now:()=>new Date('2026-10-05T12:00:00Z')});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,rotate(v){vertical=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('management shortcut popup guards portrait, rotates, closes outside and restores focus',async t=>{
  let calls=0;const {view,root,dom,rotate}=setup(t,async options=>{calls++;assert.equal(options.reportNumber,9);return {launches:[row],provisions:[],productTypes:[]};},true);
  const trigger=dom.window.document.querySelector('#app button');trigger.focus();
  await view.open();assert.equal(calls,1);assert.match(root.textContent,/POSICIONAR O TELEFONE NA HORIZONTAL/);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  assert.equal(root.querySelectorAll('.gm-table').length,7);
  root.querySelector('td').click();assert.equal(root.hidden,false);
  root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.body.style.overflow,'');
});
test('management tables match reference sections with totals, rowspans, safe labels and DATA period',async t=>{
  const {view,root,dom}=setup(t,async()=>({launches:[{...row,paymentDate:'2026-10-02'},{...row,id:'2',branch:'Central',quantity:1,total:10,product:'<img src=x onerror=alert(1)>'},{...row,id:'3',date:'2026-09-02',total:900}],provisions:[],productTypes:[{product:'Cimento',expenseType:'MATERIAL'}]}));
  await view.open();
  assert.equal(root.querySelector('[name=year]').value,'2026');assert.equal(root.querySelector('[name=month]').value,'10');
  assert.deepEqual([...root.querySelectorAll('.gm-section-title')].map(n=>n.textContent),['RESUMO GERENCIAL DE GASTOS','TOTAL GASTO ACUMULADO POR FILIAL','PERCENTUAL POR TIPO DE DESPESA POR FILIAL','PRODUTOS COM MAIOR GASTO POR FILIAL','ETAPAS COM MAIOR GASTO POR FILIAL','PRINCIPAIS FORNECEDORES POR FILIAL','MAIORES GASTOS POR CONTA POR FILIAL']);
  assert.match(root.querySelector('[data-metric=total]').textContent,/35,00/);assert.equal(root.querySelector('[data-metric=count]').textContent,'2');
  assert.equal(root.querySelector('[data-metric=period]').textContent,'outubro/2026');
  assert.equal(root.querySelector('[data-section=expense] [data-column=branch]').rowSpan,2);
  assert.match(root.querySelector('[data-section=expense] .gm-total td').textContent,/TOTAL DA FILIAL/);
  assert.equal(root.querySelectorAll('tbody img').length,0);
  assert.equal(root.querySelectorAll('.gm-logo img').length,1);
  assert.equal(root.querySelector('.pl-close'),null);
  const stage=root.querySelector('[name=stage]');stage.value='Fundação';stage.dispatchEvent(new dom.window.Event('change'));
  const month=root.querySelector('[name=month]');month.value='';month.dispatchEvent(new dom.window.Event('change'));
  assert.match(root.querySelector('[data-metric=total]').textContent,/935,00/);
  const year=root.querySelector('[name=year]');year.value='';year.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelector('[data-metric=period]').textContent,'Todos os períodos');
});
test('management cancellation and partial data never expose stale definitive totals',async t=>{
  let finish,signal;const {view,root}=setup(t,options=>{signal=options.signal;return new Promise(r=>finish=r);});
  const opening=view.open();view.close();assert.equal(signal.aborted,true);finish({launches:[row],provisions:[],productTypes:[]});await opening;
  assert.equal(root.querySelectorAll('.gm-table').length,0);
  const incomplete=setup(t,async()=>({launches:[{...row,total:null}],provisions:[],productTypes:[]}));await incomplete.view.open();
  assert.equal(incomplete.root.querySelector('[data-metric=total]').textContent,'INCOMPLETO');
  const error=setup(t,async()=>{throw new Error('Falha SharePoint');});await error.view.open();
  assert.equal(error.root.querySelectorAll('.gm-table').length,0);assert.match(error.root.querySelector('.pl-notice').textContent,/Atualizar/);
  const invalid=setup(t,async()=>({launches:[row],productTypes:[]}));await invalid.view.open();assert.equal(invalid.root.querySelectorAll('.gm-table').length,0);
});

test('tabela de despesas mostra PAGO, PREVISTO e TOTAL GERAL para tipos e subtotais',async t=>{
  const {view,root,dom}=setup(t,async()=>({
    launches:[
      {...row,date:'2026-09-28',paymentDate:'2026-10-02',expectedPaymentDate:'2026-10-01'},
      {...row,id:'2',date:'2026-09-29',paymentDate:'',expectedPaymentDate:'2026-10-05',total:999},
    ],
    provisions:[{branch:row.branch,product:'Cimento',supplier:'Fornecedor previsto',dueDate:'2026-10-05',total:35}],
    productTypes:[{product:'Cimento',expenseType:'MATERIAL'}],
  }));
  await view.open();
  const table=root.querySelector('[data-section=expense]');
  assert.deepEqual([...table.querySelectorAll('th[scope=col]')].map(th=>th.textContent),
    ['FILIAL','TIPO DE DESPESA','PAGO','PREVISTO','% DA FILIAL','TOTAL GERAL']);
  const amounts=tr=>[...tr.querySelectorAll('.gm-money')].map(td=>td.firstChild.textContent.replace(/\s/g,''));
  assert.deepEqual([...table.tBodies[0].rows].map(amounts),[
    ['R$25,00','R$35,00','R$60,00'],['R$25,00','R$35,00','R$60,00'],
  ]);
  const supplier=root.querySelector('[name=supplier]');supplier.value='Fornecedor previsto';
  assert.equal(supplier.value,'Fornecedor previsto');
  supplier.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(amounts(root.querySelector('[data-section=expense] .gm-total')),['R$0,00','R$35,00','R$35,00']);
});

test('detalha os produtos por filial e tipo, em ordem de total, e recolhe cada grupo separadamente',async t=>{
  const launch={...row,paymentDate:'2026-10-05'};
  const provision={branch:row.branch,supplier:'Fornecedor previsto',dueDate:'2026-10-08'};
  const {view,root,dom}=setup(t,async()=>({
    launches:[
      launch,
      {...launch,id:'2',product:'Tijolo',total:40},
      {...launch,id:'3',product:'CIMENTO',total:5},
      {...launch,id:'4',product:'Locação',total:10},
      {...launch,id:'5',product:'Tijolo',branch:'Central',total:20},
    ],
    provisions:[
      {...provision,product:'Cimento',total:35},
      {...provision,product:'Areia',total:5},
      {...provision,product:'Areia',paidDate:'2026-10-02',total:900},
      {...provision,product:'Areia',dueDate:'2026-11-08',total:900},
      {...provision,product:'Brita',total:null},
    ],
    productTypes:['Cimento','Tijolo','Areia','Brita'].map(product=>({product,expenseType:'MATERIAL'})),
  }));
  await view.open();
  const table=root.querySelector('[data-section=expense]');
  const buttons=[...table.querySelectorAll('td[data-column=name] button')];
  const buttonFor=(expense,branch)=>buttons.find(button=>button.getAttribute('aria-label')?.includes(`${expense} — ${branch}`));
  const materials=buttonFor('MATERIAL',row.branch);
  const locacao=buttonFor('SEM TIPO DE DESPESA',row.branch);
  const central=buttonFor('MATERIAL','Central');
  const branchCell=[...table.querySelectorAll('[data-column=branch]')].find(cell=>cell.textContent===row.branch);
  const listAfter=button=>{
    const products=[];
    let tr=button.closest('tr').nextElementSibling;
    while(tr?.matches('.gm-expense-product')){
      products.push(['name','paid','forecast','total'].map(column=>tr.querySelector(`[data-column=${column}]`).firstChild.textContent.replace(/\s/g,'')));
      tr=tr.nextElementSibling;
    }
    return products;
  };
  assert.equal(buttons.length,3);
  assert.equal(table.querySelectorAll('.gm-total button').length,0);
  assert.equal(materials.getAttribute('aria-expanded'),'false');
  assert.equal(materials.textContent,'+');
  assert.deepEqual(listAfter(materials),[]);
  materials.focus();
  materials.click();
  assert.equal(materials.getAttribute('aria-expanded'),'true');
  assert.equal(materials.textContent,'−');
  assert.equal(dom.window.document.activeElement,materials);
  assert.deepEqual(listAfter(materials),[
    ['Cimento','R$30,00','R$35,00','R$65,00'],
    ['Tijolo','R$40,00','R$0,00','R$40,00'],
    ['Areia','R$0,00','R$5,00','R$5,00'],
    ['Brita','R$0,00','INCOMPLETO','INCOMPLETO'],
  ]);
  assert.equal(branchCell.rowSpan,7);
  locacao.click();
  central.click();
  assert.deepEqual(listAfter(locacao),[['Locação','R$10,00','R$0,00','R$10,00']]);
  assert.deepEqual(listAfter(central),[['Tijolo','R$20,00','R$0,00','R$20,00']]);
  assert.equal(branchCell.rowSpan,8);
  materials.click();
  assert.deepEqual(listAfter(materials),[]);
  assert.equal(materials.getAttribute('aria-expanded'),'false');
  assert.equal(materials.textContent,'+');
  assert.equal(locacao.getAttribute('aria-expanded'),'true');
  assert.equal(branchCell.rowSpan,4);
  const supplier=root.querySelector('[name=supplier]');
  supplier.value='Fornecedor previsto';
  supplier.dispatchEvent(new dom.window.Event('change'));
  const filtered=root.querySelector('[data-section=expense] td[data-column=name] button');
  filtered.click();
  assert.deepEqual(listAfter(filtered),[
    ['Cimento','R$0,00','R$35,00','R$35,00'],
    ['Areia','R$0,00','R$5,00','R$5,00'],
    ['Brita','R$0,00','INCOMPLETO','INCOMPLETO'],
  ]);
});

test('Total Geral exibe a variação mensal após o valor em cada tipo, subtotal e produto',async t=>{
  const current=(product,total)=>({...row,product,total,paymentDate:'2026-10-05'});
  const previous=(product,total)=>({...row,product,total,paymentDate:'2026-09-05'});
  const {view,root,dom}=setup(t,async()=>({
    launches:[current('Cimento',150),previous('Cimento',100),current('Novo',10),previous('Antigo',80),
      current('Zero',0),previous('Zero',0)],
    provisions:[],productTypes:['Cimento','Novo','Antigo','Zero'].map(product=>({product,expenseType:'MATERIAL'})),
  }));
  await view.open();
  const badge=node=>node.querySelector('[data-column=total] .gm-month-change');
  let table=root.querySelector('[data-section=expense]');
  const type=table.tBodies[0].rows[0];
  assert.match(type.querySelector('[data-column=total]').textContent,/R\$\s*160,00 \(- 11,11%\)/);
  assert.equal(badge(type).dataset.direction,'down');
  assert.match(badge(type).title,/setembro\/2026/);
  assert.equal(badge(table.querySelector('.gm-total')).textContent,'(- 11,11%)');
  type.querySelector('button').click();
  const details=[...table.querySelectorAll('.gm-expense-product')];
  assert.deepEqual(details.map(tr=>tr.querySelector('[data-column=name]').textContent),['Cimento','Novo','Antigo']);
  assert.deepEqual(details.map(tr=>badge(tr).textContent),['(+ 50%)','(+ ∞%)','(- 100%)']);
  assert.deepEqual(details.map(tr=>badge(tr).dataset.direction),['up','up','down']);
  type.querySelector('button').click();
  assert.equal(table.querySelectorAll('.gm-expense-product').length,0);
  const month=root.querySelector('[name=month]');month.value='';month.dispatchEvent(new dom.window.Event('change'));
  table=root.querySelector('[data-section=expense]');
  assert.equal(table.querySelectorAll('.gm-month-change').length,0);
});
