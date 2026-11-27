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
test('o nome da filial abre sua análise anual a partir do acumulado e dos rankings', async t => {
  const launch = { ...row, paymentDate: '2026-10-05' };
  let loads = 0;
  const { view, root, dom } = setup(t, async () => {
    loads++;
    return {
      launches: [
        launch,
        { ...launch, id: '2', paymentDate: '2026-09-05', supplier: 'Beta', product: 'Areia', total: 30 },
        { ...launch, id: '3', branch: 'Central', total: 500 },
        { ...launch, id: '4', paymentDate: '2024-10-05', total: 80 },
      ],
      provisions: [{ ...launch, id: '5', branch: row.branch.toLowerCase(), paymentDate: '',
        dueDate: '2026-10-20', total: 20 }],
      productTypes: [{ product: row.product, expenseType: 'MATERIAL' }],
    };
  });
  await view.open();
  const content = root.querySelector('.gm-content');
  const table = root.querySelector('[data-section=branches]');
  const dashboard = root.querySelector('.gm-expense-dashboard-backdrop');
  const totals = () => [...dashboard.querySelectorAll('.gm-expense-dashboard-metric strong')]
    .map(metric => metric.textContent.replace(/\s/g, ''));
  const branch = section => [...root.querySelectorAll(`[data-section=${section}] [data-column=branch] button`)]
    .find(button => button.textContent === row.branch);

  content.scrollTop = 120;
  branch('branches').click();
  assert.equal(dashboard.hidden, false);
  assert.equal(dashboard.querySelector('h2').textContent, row.branch);
  assert.equal(dashboard.querySelector('[role=dialog]').getAttribute('aria-label'), 'Análise da filial');
  assert.deepEqual(totals(), ['R$75,00', 'R$55,00', 'R$20,00']);
  dashboard.querySelector('.is-suppliers .gm-dashboard-rank-row').click();
  assert.deepEqual(totals(), ['R$45,00', 'R$25,00', 'R$20,00']);
  const year = dashboard.querySelector('[name=analysis-year]');
  year.value = '2024';
  year.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(totals(), ['R$80,00', 'R$80,00', 'R$0,00']);
  dashboard.querySelector('.gm-expense-dashboard-close').click();
  assert.equal(dom.window.document.activeElement, branch('branches'));
  assert.equal(root.querySelector('[data-section=branches]'), table);
  assert.equal(content.scrollTop, 120);

  for (const section of ['expense', 'products', 'stages', 'suppliers', 'accounts']) {
    branch(section).click();
    assert.equal(dashboard.hidden, false, section);
    assert.equal(root.querySelector('.gm-product-backdrop').hidden, true, section);
    assert.deepEqual(totals(), section === 'expense' ? ['R$75,00', 'R$55,00', 'R$20,00']
      : ['R$55,00', 'R$55,00', 'R$0,00'], section);
    dashboard.querySelector('.gm-expense-dashboard-close').click();
    assert.equal(dom.window.document.activeElement, branch(section), section);
  }
  assert.equal(loads, 1);
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
    launches:[launch,{...launch,id:'2',product:'Brita',supplier:'Beta',stage:'Estrutura',total:40},
      {...launch,id:'3',paymentDate:'2026-09-03'},
      {...launch,id:'4',product:'Brita',supplier:'Histórico',date:'2024-02-01',paymentDate:'2024-02-02',total:70},
      {...launch,id:'5',branch:'Outra filial',date:'2023-02-01',paymentDate:'2023-02-02',total:90}],
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
  const year=dashboard.querySelector('select[name="analysis-year"]');
  assert.equal(year?.value,'2026');
  assert.deepEqual([...year.options].map(option=>option.value),['2026','2024']);
  assert.equal(dashboard.querySelectorAll('.gm-expense-dashboard-series.is-total circle').length,12);
  const visibleValues=field=>[...dashboard.querySelectorAll(
    `.gm-expense-dashboard-series.is-${field}:not([hidden]) .gm-dashboard-value-label:not([hidden])`
  )].map(label=>label.textContent);
  assert.deepEqual(visibleValues('total'),['95']);
  assert.deepEqual(visibleValues('paid').filter(value=>value!=='0'),['25','65']);
  const paidLegend=dashboard.querySelector('.gm-dashboard-legend-item.is-paid');
  paidLegend.click();
  assert.deepEqual(visibleValues('total').filter(value=>value!=='0'),['25','95']);
  paidLegend.click();
  assert.deepEqual(visibleValues('total'),['95']);
  const monthDetail=dashboard.querySelector('.gm-expense-dashboard-month-detail');
  assert.ok(monthDetail);
  const trend=dashboard.querySelector('.gm-expense-dashboard-trend');
  const september=trend.querySelector('.gm-expense-dashboard-series.is-total [data-month-index="8"]');
  trend.dispatchEvent(new dom.window.MouseEvent('pointermove',{bubbles:true,clientX:Number(september.getAttribute('cx'))}));
  assert.equal(monthDetail.dataset.month,'2026-09');
  const octoberPaid=[...dashboard.querySelectorAll('.gm-expense-dashboard-series.is-paid circle')]
    .find(point=>point.getAttribute('aria-label').includes('out/26'));
  octoberPaid.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  const selectedDetail=dashboard.querySelector('.gm-expense-dashboard-month-detail');
  assert.match(selectedDetail.textContent,/out\/26/i);
  assert.match(selectedDetail.textContent.replace(/\u00a0/g,' '),/Pago.*R\$ 65,00/s);
  assert.deepEqual([...dashboard.querySelectorAll('.gm-expense-dashboard-ranking h3')].map(node=>node.textContent),
    ['Principais produtos','Principais fornecedores','Principais etapas']);
  assert.equal(dashboard.querySelector('.gm-expense-dashboard-metric.is-total strong').textContent.replace(/\u00a0/g,' '),'R$ 95,00');
  dashboard.querySelector('.gm-dashboard-legend-item.is-paid').click();
  year.focus();
  year.value='2024';
  year.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(dom.window.document.activeElement,year);
  assert.match(dashboard.querySelector('.gm-expense-dashboard-trend-card h3').textContent,/2024/);
  assert.equal(dashboard.querySelector('.gm-dashboard-month-label').textContent,'jan/24');
  assert.deepEqual([...dashboard.querySelectorAll('.gm-expense-dashboard-metric strong')]
    .map(metric=>metric.textContent.replace(/\s/g,'')),['R$70,00','R$70,00','R$0,00']);
  assert.deepEqual([...dashboard.querySelectorAll('.is-suppliers .gm-dashboard-rank-name')].map(node=>node.textContent),['Histórico']);
  assert.equal(dashboard.querySelector('.gm-dashboard-legend-item.is-paid').getAttribute('aria-pressed'),'false');
  assert.deepEqual(visibleValues('total').filter(value=>value!=='0'),['70']);
  const lastControl=[...dashboard.querySelectorAll('.gm-dashboard-rank-row')].at(-1);
  year.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(dom.window.document.activeElement,lastControl);
  lastControl.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(dom.window.document.activeElement,year);
  dashboard.querySelector('.gm-expense-dashboard-close').click();
  assert.equal(root.querySelector('.gm-expense-dashboard-backdrop').hidden,true);
  assert.equal(root.querySelector('.gm-dialog').inert,false);
  assert.equal(root.ownerDocument.activeElement,focused);
  assert.equal(loads,1);
  assert.equal(expandButton.getAttribute('aria-expanded'),'false');
  typeButton.click();
  assert.equal(year.value,'2026');
  assert.equal(dashboard.querySelector('.gm-dashboard-legend-item.is-paid').getAttribute('aria-pressed'),'true');
  dashboard.querySelector('.gm-expense-dashboard-close').click();
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
  type.querySelector('.gm-expense-toggle').click();
  const details=[...table.querySelectorAll('.gm-expense-product')];
  assert.deepEqual(details.map(tr=>tr.querySelector('[data-column=name]').textContent),['Cimento','Novo','Antigo']);
  assert.deepEqual(details.map(tr=>badge(tr).textContent),['(+ 50%)','(+ ∞%)','(- 100%)']);
  assert.deepEqual(details.map(tr=>badge(tr).dataset.direction),['up','up','down']);
  type.querySelector('.gm-expense-toggle').click();
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
  assert.equal(dom.window.document.activeElement,[...popup.querySelectorAll('[data-chart-option]')].at(-1));
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
      { ...october, id: '7', date: '2024-10-01', paymentDate: '2024-10-02', total: 19 },
      { ...october, id: '8', date: '2023-10-01', paymentDate: '2023-10-02', product: 'Areia', total: 20 },
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
  assert.match(paid.querySelector('circle[data-month-index="8"]').getAttribute('aria-label'), /set\/26: R\$\s*41,00/);
  assert.match(paid.querySelector('circle[data-month-index="9"]').getAttribute('aria-label'), /out\/26: R\$\s*25,00/);
  const year = dashboard.querySelector('select[name=analysis-year]');
  assert.deepEqual([...year.options].map(option => option.value), ['2026','2024']);
  year.value = '2024';
  year.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match(dashboard.querySelector('.gm-expense-dashboard-metric.is-total strong').textContent, /19,00/);

  dashboard.querySelector('button').click();
  assert.equal(dashboard.hidden, true);
  assert.equal(dom.window.document.activeElement, supplier);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(scroll.scrollTop, 120);
  assert.equal(product.value, row.product);
});

test('análise inicia no ano atual vazio e só permite escolher o ano com dispêndio', async t => {
  const { view, root, dom } = setup(t, async () => ({
    launches: [{ ...row, date: '2024-10-01', paymentDate: '2024-10-02' }],
    productTypes: [],
    provisions: [],
  }));
  await view.open();
  const reportYear = root.querySelector('[name=year]');
  reportYear.value = '2024';
  reportYear.dispatchEvent(new dom.window.Event('change'));
  root.querySelector('[data-section=expense] [data-expense-type]').click();
  const dashboard = root.querySelector('.gm-expense-dashboard');
  const year = dashboard.querySelector('select[name=analysis-year]');
  const total = () => dashboard.querySelector('.gm-expense-dashboard-metric.is-total strong').textContent.replace(/\s/g, '');
  assert.equal(year.value, '2026');
  assert.deepEqual([...year.options].filter(option => !option.disabled).map(option => option.value), ['2024']);
  assert.equal(total(), 'R$0,00');
  year.value = '2024';
  year.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(total(), 'R$25,00');
  assert.equal(reportYear.value, '2024');
});

test('os gráficos de uma etapa cruzam produto, fornecedor e mês sem mudar o escopo da filial', async t => {
  const october = { ...row, paymentDate: '2026-10-03' };
  const { view, root } = setup(t, async () => ({
    launches: [
      october,
      { ...october, id: '2', supplier: 'Beta', product: 'Areia', total: 40 },
      { ...october, id: '3', paymentDate: '2026-09-03', total: 10 },
      { ...october, id: '4', stage: 'Outra etapa', total: 500 },
    ],
    provisions: [{ ...october, id: 'p1', paymentDate: '', dueDate: '2026-10-20', supplier: 'Beta', total: 30 }],
    productTypes: [],
  }));
  await view.open();
  [...root.querySelectorAll('[data-section=stages] button[aria-haspopup=dialog]')]
    .find(button => button.textContent === row.stage).click();
  const dashboard = root.querySelector('.gm-expense-dashboard');
  const scroll = dashboard.querySelector('.gm-expense-dashboard-scroll');
  const bars = section => [...dashboard.querySelectorAll(`.is-${section} .gm-dashboard-rank-row`)];
  const bar = (section, name) => bars(section).find(item => item.querySelector('.gm-dashboard-rank-name').textContent === name);
  const names = section => bars(section).map(item => item.querySelector('.gm-dashboard-rank-name').textContent);
  const total = () => dashboard.querySelector('.gm-expense-dashboard-metric.is-total strong').textContent.replace(/\s/g, '');
  const point = index => dashboard.querySelector(`.gm-expense-dashboard-series.is-total circle[data-month-index="${index}"]`);
  assert.equal(total(), 'R$105,00');
  scroll.scrollTop = 120;
  bar('products', 'Areia').click();
  assert.equal(total(), 'R$40,00');
  assert.deepEqual(names('suppliers'), ['Beta']);
  assert.deepEqual(names('products'), ['Cimento', 'Areia']);
  assert.equal(bar('products', 'Areia').getAttribute('aria-pressed'), 'true');
  assert.equal(root.ownerDocument.activeElement, bar('products', 'Areia'));
  assert.equal(scroll.scrollTop, 120);
  assert.match(point(8).getAttribute('aria-label'), /0,00/);
  bar('products', 'Areia').click();
  assert.equal(total(), 'R$105,00');
  bar('suppliers', 'Beta').click();
  assert.equal(total(), 'R$70,00');
  assert.deepEqual(names('products'), ['Areia', 'Cimento']);
  point(8).dispatchEvent(new root.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal(total(), 'R$10,00');
  assert.deepEqual(names('products'), ['Cimento']);
  assert.deepEqual(names('suppliers'), ['Alfa']);
  assert.equal(point(8).getAttribute('aria-pressed'), 'true');
  point(8).dispatchEvent(new root.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(total(), 'R$105,00');
  point(9).focus();
  point(9).dispatchEvent(new root.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  const focusedPoint = root.ownerDocument.activeElement;
  focusedPoint.dispatchEvent(new root.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(total(), 'R$10,00');
});

test('um fornecedor revelado pelo mês fica selecionável mesmo fora dos oito maiores do ano', async t => {
  const october = { ...row, paymentDate: '2026-10-03' };
  const { view, root, dom } = setup(t, async () => ({
    launches: [october, ...Array.from({ length: 8 }, (_, index) => ({
      ...october, id: String(index + 2), supplier: `Fornecedor ${index}`, paymentDate: '2026-09-03', total: 100 + index,
    }))],
    provisions: [],
    productTypes: [],
  }));
  await view.open();
  root.querySelector('[data-section=stages] button[aria-haspopup=dialog]').click();
  const dashboard = root.querySelector('.gm-expense-dashboard');
  const supplier = () => [...dashboard.querySelectorAll('.is-suppliers .gm-dashboard-rank-row')]
    .find(button => button.querySelector('.gm-dashboard-rank-name').textContent === 'Alfa');
  assert.equal(supplier(), undefined);
  dashboard.querySelector('.gm-expense-dashboard-series.is-total circle[data-month-index="9"]')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  supplier().click();
  assert.equal(supplier()?.getAttribute('aria-pressed'), 'true');
  assert.equal(dom.window.document.activeElement, supplier());
  assert.equal(supplier().querySelector('.gm-dashboard-rank-number').textContent, '09');
  supplier().click();
  assert.equal(supplier(), undefined);
  assert.match(dashboard.querySelector('.gm-expense-dashboard-metric.is-total strong').textContent, /853,00/);
});

test('gráficos de compra de um produto cruzam fornecedor, quantidade e valor mensal', async t => {
  const october = { ...row, paymentDate: '2026-10-03' };
  const { view, root, dom } = setup(t, async () => ({
    launches: [
      october,
      { ...october, id: '2', supplier: 'Beta', total: 40, quantity: 4 },
      { ...october, id: '3', date: '2026-09-03', total: 10, quantity: 1 },
    ],
    provisions: [],
    productTypes: [],
  }));
  await view.open();
  root.querySelector('[data-section=products] .gm-product-link').click();
  const popup = root.querySelector('.gm-product-dialog');
  const supplier = name => popup.querySelector(`[data-supplier-bar="${name}"]`);
  const amount = month => popup.querySelector(`[data-month-point="2026-${month}"]`);
  const quantity = month => popup.querySelector(`[data-month-bar="2026-${month}"]`);
  const click = node => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(amount('10').textContent, /65,00/);
  click(supplier('Beta'));
  assert.match(amount('10').textContent, /40,00/);
  assert.match(quantity('10').textContent, /: 4$/);
  assert.match(amount('09').textContent, /0,00/);
  click(quantity('09'));
  assert.equal(supplier('Beta'), null);
  assert.match(supplier('Alfa').textContent, /10,00/);
  assert.match(amount('10').textContent, /0,00/);
  click(quantity('09'));
  assert.match(amount('10').textContent, /65,00/);
  click(amount('09'));
  assert.equal(supplier('Beta'), null);
  assert.match(quantity('10').textContent, /: 0$/);
  assert.equal(popup.querySelectorAll('[data-entry-id]').length, 2);
});

for (const [section, field, subject, breakdown, totals, september] of [
  ['stages', 'stage', 'da etapa', 'PRODUTO', ['R$100,00', 'R$65,00', 'R$35,00'], '40,00'],
  ['accounts', 'account', 'da conta', 'FORNECEDOR', ['R$134,00', 'R$95,00', 'R$39,00'], '70,00'],
]) {
  test(`nome ${subject} abre o gráfico mensal da filial e preserva o detalhamento em linha`, async t => {
    const { normalizeManagementProvision } = await import('../src/chat/spending-reports-model.js');
    const october = { ...row, paymentDate: '2026-10-02', total: 25 };
    const septemberLaunch = { ...october, date: '2026-09-02', paymentDate: '2026-09-15' };
    const provision = (id, total, fields = {}) => normalizeManagementProvision({
      id, fields: { FILIAL: row.branch, FORNECEDOR: row.supplier, PRODUTO: row.product, ETAPA: row.stage,
        FORMAPGTO: row.account, DATAPREVISTOPGTO: '2026-10-20', VALORTOTAL: total, ...fields },
    });
    const { view, root, dom } = setup(t, async () => ({
      launches: [
        october,
        { ...septemberLaunch, id: '2', account: 'Outra conta', total: 40 },
        { ...septemberLaunch, id: '3', stage: 'Outra etapa', total: 70 },
        { ...october, id: '4', branch: 'Outra filial', total: 500 },
        { ...october, id: '5', account: 'CAIXA', stage: 'FUNDAÇÃO', total: 600 },
        { ...october, id: '6', product: 'Areia', total: 800 },
      ],
      provisions: [
        provision('7', 22),
        provision('8', 13, { FORMAPGTO: '' }),
        provision('9', 17, { ETAPA: 'Outra etapa' }),
        provision('10', 900, { DATAPGTOEFETUADO: '2026-10-05' }),
        provision('11', 700, { FILIAL: 'Outra filial' }),
      ],
      productTypes: [],
    }));
    await view.open();
    const product = root.querySelector('[name=product]');
    product.value = row.product;
    product.dispatchEvent(new dom.window.Event('change'));

    const ranking = root.querySelector(`[data-section=${section}]`);
    const dashboard = root.querySelector('.gm-expense-dashboard-backdrop');
    const button = [...ranking.querySelectorAll('button[aria-haspopup=dialog]')]
      .find(button => button.textContent === row[field] && button.getAttribute('aria-label').includes(row.branch));
    assert.ok(button, `o nome ${subject} deve abrir o gráfico`);
    const toggle = button.closest('tr').querySelector('.gm-expense-toggle');
    toggle.click();
    assert.equal(dashboard.hidden, true);
    assert.equal(ranking.querySelector('.gm-ranking-breakdown th').textContent, breakdown);

    const scroll = root.querySelector('.gm-content');
    scroll.scrollTop = 180;
    button.click();
    assert.equal(dashboard.hidden, false);
    assert.equal(dashboard.querySelector('[role=dialog]').getAttribute('aria-label'), `Análise ${subject}`);
    assert.equal(dashboard.querySelector('h2').textContent, row[field]);
    assert.equal(dashboard.querySelector('header p').textContent, row.branch);
    assert.deepEqual([...dashboard.querySelectorAll('.gm-expense-dashboard-metric strong')]
      .map(metric => metric.textContent.replace(/\s/g, '')), totals);
    const paid = [...dashboard.querySelectorAll('.gm-expense-dashboard-series.is-paid circle')];
    assert.equal(paid.length, 12);
    assert.equal(paid[8].getAttribute('aria-label').replace(/\s+/g, ' '), `Pago em set/26: R$ ${september}`);
    assert.equal(dashboard.querySelectorAll('.gm-expense-dashboard-ranking.is-stages').length,
      field === 'stage' ? 0 : 1);

    dashboard.querySelector('.gm-expense-dashboard-close').click();
    assert.equal(dashboard.hidden, true);
    assert.equal(dom.window.document.activeElement, button);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(scroll.scrollTop, 180);
    assert.equal(product.value, row.product);
  });
}
