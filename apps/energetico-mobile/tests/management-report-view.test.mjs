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
test('management tables match reference sections with totals, rowspans, safe labels and payment period',async t=>{
  const {view,root,dom}=setup(t,async()=>({launches:[{...row,paymentDate:'2026-10-02'},{...row,id:'2',paymentDate:'2026-10-02',branch:'Central',quantity:1,total:10,product:'<img src=x onerror=alert(1)>'},{...row,id:'3',date:'2026-09-02',paymentDate:'2026-09-02',total:900}],provisions:[],productTypes:[{product:'Cimento',expenseType:'MATERIAL'}]}));
  await view.open();
  assert.equal(root.querySelector('[name=year]').value,'2026');assert.equal(root.querySelector('[name=month]').value,'10');
  assert.deepEqual([...root.querySelectorAll('.gm-section-title')].map(n=>n.textContent),['RESUMO GERENCIAL DE GASTOS','TOTAL GASTO ACUMULADO POR FILIAL','PERCENTUAL POR TIPO DE DESPESA POR FILIAL','PRODUTOS COM MAIOR GASTO POR FILIAL','ETAPAS COM MAIOR GASTO POR FILIAL','PRINCIPAIS FORNECEDORES POR FILIAL','MAIORES GASTOS POR CONTA POR FILIAL']);
  assert.match(root.querySelector('[data-metric=total]').textContent,/35,00/);assert.equal(root.querySelector('[data-metric=count]'),null);
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
  const incomplete=setup(t,async()=>({launches:[{...row,paymentDate:'2026-10-02',total:null}],provisions:[],productTypes:[]}));await incomplete.view.open();
  assert.equal(incomplete.root.querySelector('[data-metric=total]').textContent,'INCOMPLETO');
  const error=setup(t,async()=>{throw new Error('Falha SharePoint');});await error.view.open();
  assert.equal(error.root.querySelectorAll('.gm-table').length,0);assert.match(error.root.querySelector('.pl-notice').textContent,/Atualizar/);
  const invalid=setup(t,async()=>({launches:[row],productTypes:[]}));await invalid.view.open();assert.equal(invalid.root.querySelectorAll('.gm-table').length,0);
});

test('rankings expand exact branch and period rows, with product and supplier breakdowns and independent toggles',async t=>{
  const launch={...row,paymentDate:'2026-10-07'};
  let loads=0;
  const {view,root,dom}=setup(t,async()=>{loads++;return {launches:[
    launch,
    {...launch,id:'2',product:'Brita',quantity:3,unit:10.1234,freight:0,total:30.3702,paymentDate:''},
    {...launch,id:'3',product:'Brita',supplier:'Beta',account:'Banco',total:80},
    {...launch,id:'4',supplier:'ALFA',stage:'Outros',account:'Caixa',total:20},
    {...launch,id:'5',supplier:'Beta',account:'Caixa',total:15},
    {...launch,id:'6',branch:'Central',total:100},
    {...launch,id:'7',date:'2026-09-20',total:200},
  ],provisions:[{...launch,id:'8',dueDate:'2026-10-11',total:800}],productTypes:[]};});
  await view.open();
  const section=name=>root.querySelector(`[data-section=${name}]`);
  const toggle=(table,text)=>[...table.querySelectorAll('button[aria-expanded]')]
    .find(button=>button.parentElement.lastElementChild.textContent===text);
  const detailOf=button=>button.closest('tr').nextElementSibling.querySelector('table');
  const launchIds=table=>[...table.querySelectorAll('[data-launch-id]')].map(tr=>tr.dataset.launchId);
  const text=value=>value.replace(/\s+/g,' ').trim();
  const supplier=toggle(section('suppliers'),'Alfa');
  assert.equal(supplier.textContent,'+');
  assert.equal(supplier.getAttribute('aria-expanded'),'false');
  const branchCell=section('suppliers').querySelector('[data-column=branch]');
  const originalSpan=branchCell.rowSpan;
  supplier.click();
  assert.equal(supplier.textContent,'−');
  assert.equal(branchCell.rowSpan,originalSpan+1);
  const supplierLaunches=detailOf(supplier);
  assert.deepEqual(launchIds(supplierLaunches),['1','2']);
  assert.deepEqual([...supplierLaunches.querySelectorAll('th[scope=col]')].map(th=>th.textContent),
    ['PRODUTO','DATA PGTO EFETUADO','QTD','VALOR UNITÁRIO','FRETE','TOTAL']);
  assert.deepEqual([...supplierLaunches.querySelector('[data-launch-id="1"]').cells].map(td=>text(td.textContent)),
    ['Cimento','07/10/2026','2','R$ 10,00','R$ 5,00','R$ 25,00']);
  assert.deepEqual([...supplierLaunches.querySelector('[data-launch-id="2"]').cells].map(td=>text(td.textContent)),
    ['Brita','—','3','R$ 10,1234','R$ 0,00','R$ 30,37']);
  assert.match(supplierLaunches.textContent,/TOTAL DO MÊS.*outubro\/2026/);
  assert.match(supplierLaunches.textContent,/55,37/);

  const stage=toggle(section('stages'),'Fundação');
  stage.click();
  const products=detailOf(stage),brita=toggle(products,'Brita');
  assert.ok(brita);
  assert.match(brita.closest('tr').textContent,/110,37/);
  brita.click();
  assert.deepEqual(launchIds(detailOf(brita)),['3','2']);

  const account=toggle(section('accounts'),'Caixa');
  account.click();
  const suppliers=detailOf(account),accountAlfa=toggle(suppliers,'Alfa'),accountUpper=toggle(suppliers,'ALFA');
  assert.deepEqual([...suppliers.querySelectorAll('button[aria-expanded]')].map(button=>button.parentElement.lastElementChild.textContent),
    ['Alfa','ALFA','Beta']);
  accountAlfa.click();accountUpper.click();
  assert.deepEqual(launchIds(detailOf(accountAlfa)),['1','2']);
  assert.deepEqual(launchIds(detailOf(accountUpper)),['4']);
  assert.equal(supplier.getAttribute('aria-expanded'),'true');
  account.click();
  assert.equal(account.getAttribute('aria-expanded'),'false');
  assert.equal(supplier.getAttribute('aria-expanded'),'true');
  supplier.click();
  assert.equal(branchCell.rowSpan,originalSpan);
  const month=root.querySelector('[name=month]');
  month.value='';month.dispatchEvent(new dom.window.Event('change'));
  const allMonths=toggle(section('suppliers'),'Alfa');
  allMonths.click();
  assert.deepEqual(launchIds(detailOf(allMonths)),['1','2','7']);
  assert.equal(detailOf(allMonths).querySelectorAll('tbody').length,2);
  assert.equal(loads,1);
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

test('clicar no nome do tipo abre dashboard acima do relatório e fechar retorna ao mesmo contexto',async t=>{
  let loads=0;
  const launch={...row,date:'2026-10-02',paymentDate:'2026-10-03'};
  const {view,root,dom}=setup(t,async()=>{loads++;return {
    launches:[launch,{...launch,id:'2',product:'Brita',supplier:'Beta',stage:'Estrutura',total:40}],
    provisions:[{id:'p1',branch:row.branch,product:'Cimento',supplier:'Beta',stage:'Estrutura',dueDate:'2026-10-20',total:30}],
    productTypes:[{product:'Cimento',expenseType:'MATERIAL'},{product:'Brita',expenseType:'MATERIAL'}],
  };});
  await view.open();
  const expense=root.querySelector('[data-section=expense]');
  const typeButton=expense.querySelector('[data-expense-type]');
  const expandButton=expense.querySelector('.gm-expense-toggle');
  const focused=typeButton;
  typeButton.click();
  const dashboard=root.querySelector('[aria-label="Análise do tipo de despesa"]');
  assert.ok(dashboard);
  assert.equal(root.querySelector('.gm-dialog').inert,true);
  assert.match(dashboard.textContent,/MATERIAL/);
  assert.match(dashboard.textContent,/004 - EDIFÍCIO XAVANTE/);
  assert.equal(dashboard.querySelectorAll('.gm-expense-dashboard-series.is-total circle').length,12);
  assert.equal(dashboard.querySelectorAll('.gm-dashboard-value-label').length,36);
  const monthDetail=dashboard.querySelector('.gm-expense-dashboard-month-detail');
  assert.ok(monthDetail);
  const trend=dashboard.querySelector('.gm-expense-dashboard-trend');
  const september=trend.querySelector('.gm-expense-dashboard-series.is-total [data-month-index="10"]');
  trend.dispatchEvent(new dom.window.MouseEvent('pointermove',{bubbles:true,clientX:Number(september.getAttribute('cx'))}));
  assert.equal(monthDetail.dataset.month,'2026-09');
  const octoberPaid=[...dashboard.querySelectorAll('.gm-expense-dashboard-series.is-paid circle')]
    .find(point=>point.getAttribute('aria-label').includes('out/26'));
  octoberPaid.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  assert.match(monthDetail.textContent,/out\/26/i);
  assert.match(monthDetail.textContent.replace(/\u00a0/g,' '),/Pago.*R\$ 65,00/s);
  assert.deepEqual([...dashboard.querySelectorAll('.gm-expense-dashboard-ranking h3')].map(node=>node.textContent),
    ['Principais produtos','Principais fornecedores','Principais etapas']);
  assert.equal(dashboard.querySelector('.gm-expense-dashboard-metric.is-total strong').textContent.replace(/\u00a0/g,' '),'R$ 95,00');
  dashboard.querySelector('.gm-expense-dashboard-close').click();
  assert.equal(root.querySelector('.gm-expense-dashboard-backdrop').hidden,true);
  assert.equal(root.querySelector('.gm-dialog').inert,false);
  assert.equal(root.ownerDocument.activeElement,focused);
  assert.equal(loads,1);
  assert.equal(expandButton.getAttribute('aria-expanded'),'false');
  expandButton.click();
  assert.equal(expandButton.getAttribute('aria-expanded'),'true');
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
  const buttons=[...table.querySelectorAll('td[data-column=name] button.gm-expense-type-link')];
  const buttonFor=(expense,branch)=>buttons.find(button=>button.getAttribute('aria-label')?.includes(`${expense} — ${branch}`))
    ?.closest('tr').querySelector('.gm-expense-toggle');
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

test('produto abre os registros em popup e Fechar devolve o mesmo relatório, filtros, expansão, rolagem e foco',async t=>{
  let reads=0;
  const {view,root,dom}=setup(t,async()=>{
    reads++;
    return {launches:[
      {...row,paymentDate:'2026-10-05'},
      {...row,id:'2',date:'2026-09-01',paymentDate:'2026-09-05',total:10},
      {...row,id:'3',supplier:'Outro',paymentDate:'2026-10-05',total:999},
    ],provisions:[{id:'9',product:'Cimento',branch:row.branch,supplier:'Alfa',date:'2026-10-01',
      dueDate:'2026-10-15',unit:20,quantity:2,freight:0,total:40}],
    productTypes:[{product:'Cimento',expenseType:'MATERIAL'}]};
  });
  await view.open();
  const supplier=root.querySelector('[name=supplier]');
  supplier.value='Alfa';supplier.dispatchEvent(new dom.window.Event('change'));
  const scroll=root.querySelector('.gm-content');
  const expense=root.querySelector('[data-section=expense]');
  const toggle=expense.querySelector('.gm-expense-toggle');
  toggle.click();
  const product=expense.querySelector('.gm-expense-product .gm-product-link');
  assert.ok(product,'o produto precisa ser selecionável');
  const previousMarkup=scroll.innerHTML;
  scroll.scrollTop=180;scroll.scrollLeft=7;
  product.focus();product.click();
  const popup=root.querySelector('.gm-product-backdrop');
  assert.equal(popup.hidden,false);
  assert.equal(root.querySelector('.gm-dialog').inert,true);
  assert.equal(reads,1,'abrir o produto usa o snapshot completo já carregado');
  assert.deepEqual([...popup.querySelectorAll('thead th')].map(th=>th.textContent),
    ['DATA','DATAPGTOEFETUADO','FORNECEDOR','QTD','VALOR UNITÁRIO','TOTAL']);
  assert.deepEqual([...popup.querySelectorAll('[data-entry-id]')].map(tr=>tr.dataset.entryId),['9','1','2']);
  assert.match(popup.textContent,/PERÍODO ANALISADO.*outubro\/2026/);
  assert.match(popup.textContent,/MÊS ANTERIOR.*setembro\/2026/);
  const cells=[...popup.querySelector('[data-entry-id="1"]').cells].map(td=>td.textContent.replace(/\s/g,''));
  assert.deepEqual(cells,['02/10/2026','05/10/2026','Alfa','2','R$10,00','R$25,00']);
  assert.match(popup.querySelector('[data-entry-id="9"]').textContent,/PREVISTO/);
  popup.querySelector('button').click();
  assert.equal(popup.hidden,true);
  assert.equal(root.hidden,false);
  assert.equal(root.querySelector('.gm-dialog').inert,false);
  assert.equal(root.querySelector('[data-section=expense]'),expense);
  assert.equal(scroll.innerHTML,previousMarkup);
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  assert.equal(supplier.value,'Alfa');
  assert.equal(scroll.scrollTop,180);assert.equal(scroll.scrollLeft,7);
  assert.equal(dom.window.document.activeElement,product);
  assert.equal(popup.querySelectorAll('[data-entry-id]').length,0,'fechar remove os dados privados do popup');
  product.closest('tr').querySelector('[data-column=total]').click();
  assert.equal(popup.hidden,false,'a linha também abre o produto');
  popup.querySelector('button').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(popup.hidden,true);assert.equal(root.hidden,false);
});

test('ranking de produtos abre o próprio período; fechar relatório e atualizar também encerram o popup sem reaparecer',async t=>{
  const dangerous='<img src=x onerror=alert(1)>';
  const {view,root,dom}=setup(t,async()=>({launches:[{...row,product:dangerous,supplier:dangerous}],
    provisions:[],productTypes:[]}));
  await view.open();
  const product=root.querySelector('[data-section=products] .gm-product-link');
  assert.ok(product);
  product.click();
  const popup=root.querySelector('.gm-product-backdrop');
  assert.equal(popup.hidden,false);
  assert.equal(popup.querySelectorAll('img').length,0);
  assert.match(popup.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(popup.querySelectorAll('[data-entry-id]').length,1);
  assert.equal(popup.querySelectorAll('.gm-product-period').length,1);
  const close=popup.querySelector('button');
  close.focus();
  close.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(dom.window.document.activeElement,popup.querySelector('.gm-product-scroll'));
  popup.click();
  assert.equal(popup.hidden,true);assert.equal(root.hidden,false);
  product.click();
  view.close();
  assert.equal(root.hidden,true);
  assert.equal(popup.hidden,true);
  assert.equal(popup.querySelectorAll('[data-entry-id]').length,0);
  await view.open();
  assert.equal(popup.hidden,true);
  root.querySelector('[data-section=products] .gm-product-link').click();
  root.querySelector('[name=month]').dispatchEvent(new dom.window.Event('change'));
  assert.equal(popup.hidden,true,'uma mudança de filtros não deixa o detalhe antigo aberto');
});

test('nome do fornecedor abre o gráfico da filial e preserva a expansão de lançamentos', async t => {
  const october = { ...row, paymentDate: '2026-10-02', total: 25 };
  const september = { ...october, id: '2', date: '2026-09-01', paymentDate: '2026-09-02', total: 41 };
  const provision = { id: '8', branch: row.branch, supplier: row.supplier, product: row.product,
    dueDate: '2026-10-20', total: 34 };
  const { view, root, dom } = setup(t, async () => ({
    launches: [
      october, september,
      { ...october, id: '3', branch: 'Outra filial', total: 500 },
      { ...october, id: '4', supplier: 'Alfa Serviços', total: 600 },
      { ...october, id: '5', supplier: 'ALFA', total: 700 },
      { ...october, id: '6', product: 'Areia', total: 800 },
    ],
    provisions: [provision, { ...provision, id: '9', paidDate: '2026-10-09', total: 900 }],
    productTypes: [],
  }));
  await view.open();
  const product = root.querySelector('[name=product]');
  product.value = row.product;
  product.dispatchEvent(new dom.window.Event('change'));

  const ranking = root.querySelector('[data-section=suppliers]');
  const dashboard = root.querySelector('.gm-expense-dashboard-backdrop');
  const supplier = [...ranking.querySelectorAll('button[aria-haspopup=dialog]')]
    .find(button => button.textContent === row.supplier && button.getAttribute('aria-label').includes(row.branch));
  assert.ok(supplier, 'o nome do fornecedor deve abrir o gráfico');
  const toggle = supplier.closest('tr').querySelector('.gm-expense-toggle');
  toggle.click();
  assert.equal(dashboard.hidden, true);
  assert.equal(ranking.querySelector('.gm-ranking-launches [data-launch-id]').dataset.launchId, '1');

  const scroll = root.querySelector('.gm-content');
  scroll.scrollTop = 120;
  supplier.focus();
  supplier.click();

  assert.equal(dashboard.hidden, false);
  assert.equal(dashboard.querySelector('h2').textContent, row.supplier);
  assert.equal(dashboard.querySelector('header p').textContent, row.branch);
  assert.deepEqual([...dashboard.querySelectorAll('.gm-expense-dashboard-metric strong')]
    .map(metric => metric.textContent.replace(/\s/g, '')), ['R$100,00', 'R$66,00', 'R$34,00']);
  const paid = dashboard.querySelector('.gm-expense-dashboard-series.is-paid');
  assert.equal(paid.querySelectorAll('circle').length, 12);
  assert.match(paid.querySelector('circle[data-month-index="10"]').getAttribute('aria-label'), /set\/26: R\$\s*41,00/);
  assert.match(paid.querySelector('circle[data-month-index="11"]').getAttribute('aria-label'), /out\/26: R\$\s*25,00/);

  dashboard.querySelector('button').click();
  assert.equal(dashboard.hidden, true);
  assert.equal(dom.window.document.activeElement, supplier);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(scroll.scrollTop, 120);
  assert.equal(product.value, row.product);
});
