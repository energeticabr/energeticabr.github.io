import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCargosTable, parseCargosMoney } from '../src/chat/cargos-model.js';
import { createCargosData } from '../src/chat/cargos-data.js';
import { createCargosView } from '../src/ui/cargos-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';
import { JSDOM } from 'jsdom';

const columns=['CARGO','SALARIO','VALEALIMENTACAO','PREMIO','DATAREFERENCIA'].map(name=>({name,displayName:name})).concat({name:'vt_real',displayName:'VALE TRANSPORTE'});
const item=(cargo,fields={})=>({fields:{CARGO:cargo,SALARIO:1800,VALEALIMENTACAO:800,PREMIO:445,vt_real:238.33,DATAREFERENCIA:'2026-09-01T00:00:00Z',...fields}});
test('moeda da base aceita números e formato brasileiro sem inventar valores',()=>{
  assert.equal(parseCargosMoney('2.625,00'),2625);
  assert.equal(parseCargosMoney('238,33'),238.33);
  for(const v of ['',null,'abc 20','12abc',Infinity,-5])assert.equal(parseCargosMoney(v),null);
});
test('sete níveis ordenados, total exato, referência vigente e conflito explícito',()=>{
  const rows=buildCargosTable([item('SERVENTE DE PEDREIRO I'),item('PEDREIRO I',{SALARIO:2625,PREMIO:800}),item('SERVENTE DE PEDREIRO I',{SALARIO:9999,DATAREFERENCIA:'2026-11-01'})],columns,'2026-10-05');
  assert.equal(rows.length,7);assert.equal(rows[0].total,3283.33);assert.equal(rows[3].total,4463.33);
  assert.equal(rows[6].cargo,'MESTRE DE OBRAS');assert.equal(rows[6].total,null);
  assert.equal(buildCargosTable([item('PEDREIRO I'),item('PEDREIRO I',{PREMIO:100})],columns,'2026-10-05')[3].total,null);
  assert.equal(buildCargosTable([item('PEDREIRO I',{vt_real:''})],columns,'2026-10-05')[3].total,null);
});
test('Supervisor de Obras recebe uma linha quando cadastrado na base salarial',()=>{
  const rows=buildCargosTable([item('Supervisor de Obras')],columns,'2026-10-05');
  assert.equal(rows.length,8);
  assert.equal(rows[7].cargo,'SUPERVISOR DE OBRAS');
  assert.equal(rows[7].total,3283.33);
});
test('leitor usa metadados reais, todas as páginas e recusa paginação quebrada',async()=>{
  let calls=0;
  const repository={resolveList:async(site,names)=>{assert.equal(site,'personal');assert.deepEqual(names,['CARGOS']);return {status:'resolved',id:'cargos'};},getColumns:async()=>columns,getItemsPage:async()=>++calls===1?{items:[item('PEDREIRO I')],hasMore:true,nextLink:'page2'}:{items:[item('MESTRE DE OBRAS')],hasMore:false}};
  const data=createCargosData({repository,now:()=>new Date('2026-10-05T12:00:00Z')});
  assert.equal((await data.loadSnapshot()).rows[6].total,3283.33);assert.equal(calls,2);
  repository.getItemsPage=async()=>({items:[],hasMore:true,nextLink:'repeated'});
  await assert.rejects(data.loadSnapshot(),/paginação/i);
  repository.getItemsPage=async()=>({items:[],hasMore:false});
  repository.getColumns=async()=>columns.filter(c=>c.name!=='vt_real');
  await assert.rejects(data.loadSnapshot(),/VALE TRANSPORTE/);
});
test('tela inteira com grupos, atualização e cancelamento não reapresenta consulta antiga',async()=>{
  const dom=new JSDOM('<main id="app"><button id="start">Abrir</button></main>');const doc=dom.window.document;
  let loads=0,finish;const view=createCargosView({document:doc,data:{loadSnapshot:async()=>{loads++;return {rows:buildCargosTable([item('SERVENTE DE PEDREIRO I')],columns,'2026-10-05')};}}});
  doc.querySelector('#start').focus();await view.open();
  assert.equal(doc.querySelectorAll('.cargos-table tbody tr[data-cargo]').length,7);
  assert.equal(doc.querySelectorAll('.cargos-group').length,2);
  assert.match(doc.querySelector('[data-column="total"]').textContent,/3.283,33/);
  doc.querySelector('[aria-label="Atualizar tabela de cargos"]').click();await new Promise(r=>setImmediate(r));assert.equal(loads,2);
  view.close();assert.equal(doc.activeElement.id,'start');
  view.destroy();
  const late=createCargosView({document:doc,data:{loadSnapshot:()=>new Promise(r=>{finish=r;})}});
  const pending=late.open();late.close();finish({rows:[]});await pending;
  assert.equal(doc.querySelector('.cargos-screen').hidden,true);assert.equal(doc.querySelectorAll('.cargos-table').length,0);
  late.destroy();dom.window.close();
});

test('consulta vínculos RH paginados pelo cargo cadastrado e retorna só os campos do detalhe', async () => {
  const employee = (id, Title, CARGO, PROFISSAO, STATUS = 'ATIVO') => ({ id, fields: {
    Title, CARGO, PROFISSAO, STATUS, FILIAL: 'Obra 01', Extra: 'Campo privado',
  } });
  const repository = {
    async resolveList(site, names) {
      assert.equal(site, 'personal');
      assert.deepEqual(names, ['FUNCIONARIOSRH']);
      return { status: 'resolved', id: 'rh' };
    },
    async getItemsPage(site, id, query, { cursor }) {
      assert.equal(id, 'rh');
      assert.equal(new URLSearchParams(query).get('$expand'), 'fields($select=Title,CARGO,FILIAL,STATUS)');
      return cursor === 'page2' ? {
        items: [employee('3', 'Ana', 'servente  de pedreiro i', 'Outra profissão', 'INATIVO'), employee('4', 'Caio', 'PEDREIRO II', 'SERVENTE DE PEDREIRO I'), employee('5', 'Eva', 'PEDREIRO I/II', '')], hasMore: false,
      } : {
        items: [employee('1', 'Bia', 'SERVENTE DE PEDREIRO I', ''), employee('2', 'Dani', '', 'SERVENTE DE PEDREIRO I')], hasMore: true, nextLink: 'page2',
      };
    },
  };
  const data = createCargosData({ repository });
  const links = await data.loadAssignments();
  assert.deepEqual(links.get('SERVENTE DE PEDREIRO I'), [
    { name: 'Ana', branch: 'Obra 01', status: 'INATIVO' },
    { name: 'Bia', branch: 'Obra 01', status: 'ATIVO' },
  ]);
  assert.deepEqual(links.get('PEDREIRO II'), [{ name: 'Caio', branch: 'Obra 01', status: 'ATIVO' }]);
  assert.equal(links.has('SERVENTE DE PEDREIRO II'), false);
  assert.equal(links.has('PEDREIRO III'), false);
  repository.getItemsPage = async () => ({ items: [], hasMore: true, nextLink: 'repeated' });
  await assert.rejects(data.loadAssignments(), /paginação.*FUNCIONARIOSRH/i);
});

test('cada linha expande seus próprios vínculos, reusa a consulta e mantém os nomes fora do PDF', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  let loads = 0;
  const view = createCargosView({ document: doc, data: {
    loadSnapshot: async () => ({ rows: buildCargosTable([item('SERVENTE DE PEDREIRO I')], columns, '2026-10-05') }),
    loadAssignments: async () => {
      loads++;
      if (loads === 1) throw new Error('Falha de rede');
      return new Map([['SERVENTE DE PEDREIRO I', [{ name: 'Ana Teste', branch: 'Obra 01', status: 'ATIVO' }]]]);
    },
  } });
  t.after(() => view.destroy());
  await view.open();
  const button = cargo => doc.querySelector(`tr[data-cargo="${cargo}"] button`);
  const first = button('SERVENTE DE PEDREIRO I');
  const second = button('SERVENTE DE PEDREIRO II');
  const details = control => doc.getElementById(control.getAttribute('aria-controls'));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, 0);
  assert.equal(first.getAttribute('aria-expanded'), 'false');
  first.click();
  await flush();
  assert.match(details(first).textContent, /indisponível/i);
  details(first).querySelector('button').click();
  second.click();
  await flush();
  assert.equal(loads, 2);
  assert.equal(first.getAttribute('aria-expanded'), 'true');
  assert.match(details(first).textContent, /Ana Teste.*Obra 01.*ATIVO/);
  assert.match(details(second).textContent, /Nenhum colaborador vinculado/);
  assert.doesNotMatch(details(second).textContent, /Ana Teste/);
  const pdf = JSON.stringify(captureFilteredReport(view.element));
  assert.match(pdf, /SERVENTE DE PEDREIRO I/);
  assert.doesNotMatch(pdf, /Ana Teste|Nenhum colaborador vinculado/);
  first.click();
  assert.equal(first.getAttribute('aria-expanded'), 'false');
  assert.equal(details(first).hidden, true);
  assert.equal(details(second).hidden, false);
  first.click();
  await flush();
  assert.equal(loads, 2);
  doc.querySelector('[aria-label="Atualizar tabela de cargos"]').click();
  await flush();
  button('SERVENTE DE PEDREIRO I').click();
  await flush();
  assert.equal(loads, 3);
});
