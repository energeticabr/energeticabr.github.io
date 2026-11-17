import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildSpendingReport9} from '../src/chat/spending-reports-model.js';
import {createManagementReportView} from '../src/ui/management-report-view.js';

const filters={year:'2026',month:'11',supplier:'Alfa'};
const launch=(total,paymentDate,extra={})=>({branch:'Xavante',supplier:'Alfa',product:'Cimento',
  date:'2025-01-01',paymentDate,total,...extra});
const provision=(total,dueDate,extra={})=>({branch:'Xavante',supplier:'Alfa',product:'Cimento',total,dueDate,...extra});
const snapshot={launches:[launch(100,'2026-11-02'),launch(50,'2026-10-02'),launch(999,'2026-11-02',{supplier:'Outro'})],
  provisions:[provision(50,'2026-11-03'),provision(25,'2026-10-03'),
    provision(25,'2026-11-03',{branch:'Central'}),provision(40,'2026-10-03',{branch:'Antiga'}),
    provision(999,'2026-11-03',{paidDate:'2026-11-03'})],productTypes:[]};

test('resumo soma pago e previsto das filiais, com mesmo filtro e mês anterior',()=>{
  const report=buildSpendingReport9(snapshot,filters);
  assert.deepEqual(report.summary,{paid:100,forecast:75,total:175,previousTotal:115,change:60/115*100});
  assert.equal(report.expenseBranches.reduce((sum,b)=>sum+b.total,0),report.summary.total);
});

test('resumo preserva arredondamento das filiais, incompletos, janeiro e ausência de comparação',()=>{
  const rounded=buildSpendingReport9({launches:[launch(.005,'2026-11-02'),launch(.005,'2026-11-02',{branch:'Central'})]},filters);
  assert.equal(rounded.summary.paid,.02);
  const incomplete=buildSpendingReport9({launches:[launch(10,'2026-11-02'),launch(null,'2026-10-02')]},filters);
  assert.equal(incomplete.summary.previousTotal,null);assert.equal(incomplete.summary.change,null);
  const currentMissing=buildSpendingReport9({provisions:[provision(null,'2026-11-02')]},filters);
  assert.equal(currentMissing.summary.forecast,null);assert.equal(currentMissing.summary.total,null);
  const january=buildSpendingReport9({launches:[launch(50,'2026-01-01'),launch(100,'2025-12-01')]},{year:'2026',month:'1'});
  assert.equal(january.summary.change,-50);
  for(const selected of [{},{year:'2026'},{month:'11'}])assert.equal(Object.hasOwn(buildSpendingReport9(snapshot,selected).summary,'change'),false);
});

test('resumo e tabela acumulada mostram previsto, total e comparação sem quantidade de linhas',async t=>{
  const dom=new JSDOM('<main id="app"></main>');dom.window.matchMedia=()=>({matches:false});
  const view=createManagementReportView({document:dom.window.document,data:{loadSnapshot:async()=>snapshot},now:()=>new Date('2026-11-17T12:00:00Z')});
  t.after(()=>{view.destroy();dom.window.close();});await view.open();
  const root=view.element,supplier=root.querySelector('[name=supplier]');supplier.value='Alfa';supplier.dispatchEvent(new dom.window.Event('change'));
  const amounts=tr=>[...tr.querySelectorAll('.gm-money')].map(td=>td.firstChild.textContent.replace(/\s/g,''));
  const summary=root.querySelector('[data-section=summary]');
  assert.deepEqual(amounts(summary),['R$100,00','R$75,00','R$175,00']);
  assert.match(summary.querySelector('[data-metric=change]').textContent,/\+ 52,17%/);
  assert.match(summary.querySelector('[data-metric=change]').title,/outubro\/2026/);
  const branches=root.querySelector('[data-section=branches]');
  assert.deepEqual([...branches.querySelectorAll('th[scope=col]')].map(th=>th.textContent),['FILIAL','PAGO','PREVISTO','% DO TOTAL DO MÊS','TOTAL GERAL']);
  assert.deepEqual(amounts(branches.tBodies[0].rows[0]),['R$100,00','R$50,00','R$150,00']);
  assert.match(branches.tBodies[0].rows[0].querySelector('[data-column=percentage]').textContent,/85,71%/);
  assert.match(branches.tBodies[0].rows[0].querySelector('.gm-month-change').textContent,/\+ 100%/);
  assert.equal(branches.querySelectorAll('[data-column=count]').length,0);
  assert.match(branches.textContent,/Central/);assert.match(branches.textContent,/Antiga/);
  const month=root.querySelector('[name=month]');month.value='';month.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelector('[data-metric=change]').textContent,'—');
  assert.equal(root.querySelector('[data-section=branches] .gm-month-change'),null);
});
