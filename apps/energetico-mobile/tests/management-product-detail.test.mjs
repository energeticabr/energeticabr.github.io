import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManagementProductDetail,normalizeManagementProvision} from '../src/chat/spending-reports-model.js';

const paid=(id,product,total,extra={})=>({id,product,total,date:'2026-10-03',paymentDate:'2026-11-02',
  branch:'Xavante',supplier:'Alfa',stage:'Obra',disbursement:'SIM',order:'42',quantity:2,unit:10,freight:5,...extra});
const forecast={id:'9',product:'Cimento',total:65,date:'2026-10-20',dueDate:'2026-11-05',branch:'Xavante',
  supplier:'Alfa',stage:'Obra',disbursement:'SIM',order:'42',quantity:3,unit:20,freight:5};
const filters={year:'2026',month:'11',supplier:'Alfa',stage:'Obra',disbursement:'SIM',order:'42'};

test('detalhes de despesa preservam os registros e os mesmos filtros de pagamento, produto e filial dos dois meses',()=>{
  const snapshot={launches:[
    paid('1','Cimento',25),paid('2','CIMENTO',30,{paymentDate:'2026-10-03'}),
    paid('3','Areia',999),paid('4','Cimento',999,{branch:'Outra'}),
    paid('5','Cimento',999,{supplier:'Outro'}),paid('6','Cimento',999,{stage:'Outra'}),
    paid('7','Cimento',999,{disbursement:'NÃO'}),paid('8','Cimento',999,{order:'43'}),
    paid('10','Cimento',999,{paymentDate:''}),
  ],provisions:[forecast,{...forecast,id:'11',paidDate:'2026-11-01'},{...forecast,id:'12',schedule:'PAGO'}]};
  const detail=buildManagementProductDetail(snapshot,filters,{branch:'XAVANTE',product:'Cimento',kind:'expense'});
  assert.deepEqual(detail.sections.map(section=>section.period),['novembro/2026','outubro/2026']);
  assert.deepEqual(detail.sections.map(section=>section.rows.map(row=>row.id)),[['9','1'],['2']]);
  const [provision,launch]=detail.sections[0].rows;
  assert.deepEqual([launch.date,launch.paymentDate,launch.supplier,launch.quantity,launch.unit,launch.total],
    ['2026-10-03','2026-11-02','Alfa',2,10,25]);
  assert.equal(launch.source,'paid');
  assert.deepEqual([provision.date,provision.paymentDate,provision.quantity,provision.unit,provision.total,provision.source],
    ['2026-10-20','',3,20,65,'forecast']);
});

test('ranking de produtos mantém a DATA do ranking, incluindo lançamentos sem pagamento, sem misturar as provisões',()=>{
  const detail=buildManagementProductDetail({launches:[
    paid('1','Cimento',25,{date:'2026-11-05',paymentDate:''}),
    paid('2','Cimento',999),
  ],provisions:[forecast]},filters,{branch:'Xavante',product:'Cimento',kind:'launches'});
  assert.equal(detail.sections.length,1);
  assert.deepEqual(detail.sections[0].rows.map(row=>row.id),['1']);
});

test('popup do ranking usa as mesmas grafias de produto e filial da linha clicada',()=>{
  const detail=buildManagementProductDetail({launches:[
    paid('1','Cimento',100,{date:'2026-11-05'}),
    paid('2','CIMENTO',200,{date:'2026-11-05'}),
    paid('3','Cimento',400,{date:'2026-11-05',branch:'XAVANTE'}),
  ]},filters,{branch:'Xavante',product:'Cimento',kind:'launches'});
  assert.deepEqual(detail.sections[0].rows.map(row=>row.id),['1']);
});

test('produtos ausentes e sem registros no mês não passam a selecionar todos os produtos',()=>{
  const detail=buildManagementProductDetail({launches:[
    paid('1','',25,{branch:''}),paid('2','Cimento',999,{branch:''}),
  ]},filters,{branch:'-',product:'SEM PRODUTO',kind:'expense'});
  assert.deepEqual(detail.sections[0].rows.map(row=>row.id),['1']);
  const previous=buildManagementProductDetail({launches:[paid('3','Antigo',80,{paymentDate:'2026-10-02'})]},
    filters,{branch:'Xavante',product:'Antigo',kind:'expense'});
  assert.equal(previous.sections[0].rows.length,0);
  assert.equal(previous.sections[1].rows[0].total,80);
});

test('normalização de provisão preserva data, preço, quantidade e frete sem alterar a fórmula do relatório',()=>{
  const detail=normalizeManagementProvision({id:'9',fields:{PRODUTO:'Cimento',DATA:'2026-10-20',
    VALORTOTAL:'20,50',QTD:'3',FRETE:'5,00',DATAPREVISTOPGTO:'2026-11-05'}});
  assert.deepEqual([detail.date,detail.unit,detail.quantity,detail.freight,detail.total],['2026-10-20',20.5,3,5,66.5]);
  const defaults=normalizeManagementProvision({fields:{VALORTOTAL:'20,50'}});
  assert.deepEqual([defaults.quantity,defaults.freight,defaults.total],[1,0,20.5]);
  const invalid=normalizeManagementProvision({fields:{VALORTOTAL:'inválido',QTD:'inválido',FRETE:'inválido'}});
  assert.deepEqual([invalid.unit,invalid.quantity,invalid.freight,invalid.total],[null,null,null,null]);
});
