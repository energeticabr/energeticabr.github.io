import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSpendingReport9} from '../src/chat/spending-reports-model.js';

const launch=(product,total,date,extra={})=>({product,total,date:'2020-01-01',paymentDate:date,
  branch:'Xavante',supplier:'Alfa',stage:'Obra',disbursement:'SIM',...extra});
const provision=(product,total,date,extra={})=>({product,total,dueDate:date,
  branch:'Xavante',supplier:'Alfa',stage:'Obra',disbursement:'SIM',...extra});
const snapshot={
  launches:[
    launch('Cimento',100,'2026-11-02'),launch('CIMENTO',50,'2026-11-04'),
    launch('Cimento',100,'2026-10-01'),launch('Areia',80,'2026-10-31'),
    launch('Novo',25,'2026-11-03'),launch('Zero',0,'2026-11-01'),launch('Zero',0,'2026-10-01'),
    launch('Devolução',-10,'2026-10-02'),launch('Devolução',-5,'2026-11-02'),
    launch('Outra filial',10,'2026-10-02',{branch:'Central'}),
    launch('Cimento',900,'2026-10-20',{supplier:'Outro'}),
    launch('Cimento',900,'2026-10-20',{stage:'Outra etapa'}),
  ],
  provisions:[
    provision('Cimento',50,'2026-11-15'),provision('Cimento',20,'2026-10-15'),
    provision('Areia',999,'2026-10-15',{paidDate:'2026-10-15'}),
    provision('Areia',999,'2026-10-15',{schedule:'PAGO'}),
    provision('Areia',999,'2026-10-15',{status:'PAGAMENTO EFETUADO'}),
    provision('Cimento',999,'2026-09-15'),
  ],
  productTypes:['Cimento','Areia','Novo','Zero','Devolução'].map(product=>({product,expenseType:'Material'})),
};
const filters={year:'2026',month:'11',supplier:'Alfa',stage:'Obra',disbursement:'SIM'};

test('compara os totais mensais de tipo, filial e produtos, incluindo produtos que deixaram de ter valor',()=>{
  const report=buildSpendingReport9(snapshot,filters);
  assert.equal(report.comparisonPeriod,'outubro/2026');
  const branch=report.expenseBranches.find(branch=>branch.name==='Xavante');
  assert.equal(branch.total,220);
  assert.equal(branch.previousTotal,190);
  assert.ok(Math.abs(branch.change-30/190*100)<1e-10);
  const material=branch.expenseTypes[0];
  assert.equal(material.previousTotal,190);
  const byName=Object.fromEntries(material.products.map(product=>[product.name.toLowerCase(),product]));
  assert.deepEqual(material.products.map(product=>product.name),['Cimento','Novo','Areia','Devolução']);
  assert.deepEqual([byName.cimento.paid,byName.cimento.forecast,byName.cimento.total,byName.cimento.previousTotal],
    [150,50,200,120]);
  assert.ok(Math.abs(byName.cimento.change-200/3)<1e-10);
  assert.equal(byName.novo.change,Infinity);
  assert.equal(byName.areia.change,-100);
  assert.equal(byName.areia.total,0);
  assert.equal(byName['devolução'].change,50);
  const central=report.expenseBranches.find(branch=>branch.name==='Central');
  assert.deepEqual([central.total,central.previousTotal,central.change],[0,10,-100]);
  assert.equal(central.expenseTypes[0].products[0].change,-100);
});

test('janeiro compara com dezembro do ano anterior e respeita filtro de produto',()=>{
  const report=buildSpendingReport9({launches:[
    launch('Cimento',50,'2026-01-31'),launch('Cimento',100,'2025-12-01'),
    launch('Cimento',999,'2025-01-01'),launch('Areia',999,'2025-12-01'),
  ]},{year:'2026',month:'1',product:'Cimento'});
  assert.equal(report.comparisonPeriod,'dezembro/2025');
  assert.equal(report.expenseBranches[0].change,-50);
  assert.equal(report.expenseBranches[0].expenseTypes[0].products.length,1);
});

test('sem mês e ano definidos não inventa uma comparação mensal nem puxa produtos de outro período',()=>{
  for(const selected of [{year:'2026'}, {}, {month:'11'}]){
    const report=buildSpendingReport9(snapshot,selected);
    assert.equal(report.comparisonPeriod,'');
    assert.equal(Object.hasOwn(report.expenseBranches[0],'change'),false);
  }
});

test('total anterior incompleto não vira zero ou uma variação definitiva; produto zero nos dois períodos é omitido',()=>{
  const report=buildSpendingReport9({launches:[
    launch('Cimento',10,'2026-11-01'),launch('Cimento',null,'2026-10-01'),
    launch('Areia',0,'2026-11-01'),launch('Areia',0,'2026-10-01'),
  ]},filters);
  const branch=report.expenseBranches[0];
  assert.equal(branch.previousTotal,null);
  assert.equal(branch.change,null);
  assert.equal(branch.expenseTypes[0].products.length,1);
  assert.equal(branch.expenseTypes[0].products[0].change,null);
  assert.equal(report.incompleteCount,1);
});

test('produtos sem alteração mostram variação zero e os centavos dos detalhes reconciliam nos dois meses',()=>{
  const report=buildSpendingReport9({launches:[
    ...['A','B','C'].flatMap((product,index)=>[
      launch(product,index===2?.09:.005,'2026-11-01'),
      launch(product,index===2?.09:.005,'2026-10-01'),
    ]),
  ]},filters);
  const branch=report.expenseBranches[0];
  const products=branch.expenseTypes[0].products;
  assert.equal(branch.change,0);
  assert.ok(products.every(product=>product.change===0));
  assert.equal(products.reduce((sum,product)=>sum+Math.round(product.total*100),0),Math.round(branch.total*100));
});

test('grafias em maiúsculas e minúsculas da mesma filial e tipo não descartam valores do mês anterior',()=>{
  const report=buildSpendingReport9({launches:[
    launch('Cimento',50,'2026-11-01'),
    launch('Cimento',40,'2026-10-01',{branch:'XAVANTE'}),
    launch('Areia',60,'2026-10-01'),
    launch('Areia',50,'2026-11-01',{branch:'XAVANTE'}),
  ],productTypes:[{product:'Cimento',expenseType:'Material'},{product:'Areia',expenseType:'MATERIAL'}]},
  {...filters,branch:'Xavante'});
  assert.equal(report.expenseBranches.length,1);
  const [branch]=report.expenseBranches;
  assert.deepEqual([branch.total,branch.previousTotal,branch.change],[100,100,0]);
  assert.equal(branch.expenseTypes.length,1);
  const [areia,cimento]=branch.expenseTypes[0].products;
  assert.deepEqual([areia.name,areia.previousTotal],['Areia',60]);
  assert.ok(Math.abs(areia.change+100/6)<1e-10);
  assert.deepEqual([cimento.name,cimento.previousTotal,cimento.change],['Cimento',40,25]);
});
