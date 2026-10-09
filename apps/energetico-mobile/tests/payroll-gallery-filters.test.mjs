import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createHrPayrollGallery } from '../src/ui/hr-payroll-gallery-view.js';
import { filterPayrollRows } from '../src/chat/payroll-gallery-filters.js';

test('payment filters combine current source amounts, quantity, date endpoints and linked IDs', async () => {
  const data=createHrPayrollGalleryData({repository:{
    resolveList:async(_site,names)=>({status:'resolved',id:names[0]}),
    getColumns:async()=>[{name:'VALORUNITARIO'},{name:'QUANTIDADE'}],
    getItem:async(_site,_list,id)=>({id,fields:{VALORUNITARIO:168.8,QUANTIDADE:3}}),
    getItemsPage:async()=>({hasMore:false,items:[{id:'3',fields:{FORNECEDOR:'JOSÉ',TIPOPGTO:'SALÁRIO',VALORUNITARIO:1,QTD:99,DATA:'2026-09-28T00:00:00Z',IDFOLHA:5,IDLANCAMENTO:3457}}]}),
  }});
  const result=await data.loadFilteredPage('FOLHAPGTO',{filters:{search:'jose salario',id:'3',IDFOLHA:'5',IDLANCAMENTO:'3457',
    VALORUNITARIOmin:'168,80',VALORUNITARIOmax:'168.80',QTDmin:'3',QTDmax:'3',DATAfrom:'2026-09-28',DATAto:'2026-09-28'}});
  assert.equal(result.count,1);assert.equal(result.rows[0].VALORUNITARIO,168.8);
  assert.equal(filterPayrollRows('FOLHAPGTO',result.rows,{DATAfrom:'2026-09-29'}).length,0);
  assert.equal(filterPayrollRows('FOLHAPGTO',result.rows,{search:'28/09/2026 3457'}).length,1);
  assert.throws(()=>filterPayrollRows('FOLHAPGTO',[],{QTDmin:'4',QTDmax:'3'}),/mínimo/);
  assert.throws(()=>filterPayrollRows('FOLHAPGTO',[],{DATAfrom:'2026-02-30'}),/data/);
});

test('opening a page hydrates only visible payments and a distant broken source does not block it', async () => {
  const sourceReads=[];
  const data=createHrPayrollGalleryData({repository:{
    resolveList:async(_site,names)=>({status:'resolved',id:names[0]}),
    getColumns:async()=>[{name:'VALORUNITARIO'},{name:'QUANTIDADE'}],
    getItemsPage:async()=>({hasMore:false,items:Array.from({length:30},(_,i)=>({id:String(i+1),fields:{FORNECEDOR:i>=5?'A':'B',IDLANCAMENTO:i+1}}))}),
    getItem:async(_site,_list,id)=>{sourceReads.push(id);if(id==='1') throw new Error('Source unavailable');return {id,fields:{VALORUNITARIO:200,QUANTIDADE:3}};},
  }});
  const first=await data.loadFilteredPage('FOLHAPGTO');assert.equal(first.count,30);assert.equal(first.rows.length,25);
  assert.equal(sourceReads.length,25);assert.ok(!sourceReads.includes('1'));
  assert.equal(first.rows[0].id,'30');assert.equal(first.rows.at(-1).id,'6');
  await data.loadFilteredPage('FOLHAPGTO',{filters:{FORNECEDOR:'A',QTDmin:'2'}});
  assert.equal(sourceReads.length,25,'fresh source values are reused when adjusting filters');
  await assert.rejects(data.loadFilteredPage('FOLHAPGTO',{filters:{id:'1'}}),/Source unavailable/);
});

test('filter snapshot rejects missing or repeated pagination cursors and retries failures', async () => {
  let broken=true;
  const data=createHrPayrollGalleryData({repository:{resolveList:async()=>({status:'resolved',id:'sheets'}),
    getItemsPage:async()=>broken?{items:[],hasMore:true}:{items:[],hasMore:false}}});
  await assert.rejects(data.loadFilteredPage('IDFOLHA'),/cursor/);
  broken=false;assert.equal((await data.loadFilteredPage('IDFOLHA')).count,0);
  const repeated=createHrPayrollGalleryData({repository:{resolveList:async()=>({status:'resolved',id:'sheets'}),
    getItemsPage:async()=>({items:[],hasMore:true,nextLink:'same'})}});
  await assert.rejects(repeated.loadFilteredPage('IDFOLHA'),/cursor/);
});

test('pending old response cannot cancel newly typed search and changing filters discards old pages', async t => {
  const dom=new JSDOM('<main></main>');const doc=dom.window.document;const reads=[];let resolveOld;
  const gallery=createHrPayrollGallery({document:doc,gallery:'IDFOLHA',request:async(_g,p,_size,_cursor,options)=>{
    reads.push(options.filters.search);
    if(reads.length===1) return new Promise(resolve=>{resolveOld=resolve;});
    return {gallery:'IDFOLHA',page:p,rows:[{id:'2',FORNECEDOR:'CLEITON'}],hasMore:false};
  }});
  t.after(()=>{gallery.destroy();dom.window.close();});const opening=gallery.open();
  const search=doc.querySelector('[name=search]');search.value='cleiton';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  resolveOld({gallery:'IDFOLHA',page:1,rows:[{id:'1',FORNECEDOR:'BERNARDO'}],hasMore:false});await opening;
  await new Promise(resolve=>setTimeout(resolve,220));
  assert.deepEqual(reads,['','cleiton']);assert.match(doc.querySelector('.hr-gallery-cards').textContent,/CLEITON/);
});

test('payroll filters read later pages, combine columns, and offer choices from all rows', async () => {
  const calls = [];
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async () => ({ status:'resolved', id:'sheets' }),
    getItemsPage: async (_site, _list, _query, options) => {
      calls.push(options);
      return options.cursor ? { items:[{id:'2',fields:{FORNECEDOR:'CLEITON',MESREFERENCIA:'10/2026'}}],hasMore:false }
        : { items:[{id:'1',fields:{FORNECEDOR:'BERNARDO',MESREFERENCIA:'09/2026'}}],hasMore:true,nextLink:'next' };
    },
  }});
  assert.equal(typeof data.loadFilteredPage, 'function');
  const result = await data.loadFilteredPage('IDFOLHA', {filters:{search:'cleiton',MESREFERENCIA:'10/2026'}});
  assert.deepEqual(result.rows.map(row=>row.id), ['2']);
  assert.deepEqual(result.filterOptions.FORNECEDOR, ['BERNARDO','CLEITON']);
  assert.equal(result.count, 1);
  assert.equal(calls.length, 2);
  await data.loadFilteredPage('IDFOLHA', {filters:{FORNECEDOR:'BERNARDO'}});
  assert.equal(calls.length, 2, 'changing filters reuses the complete fresh snapshot');
  await assert.rejects(data.loadFilteredPage('IDFOLHA',{filters:{unknown:'x'}}), /filtro/i);
});

test('finishing one filter request preserves another open dropdown and its choices', async t => {
  const dom=new JSDOM('<main></main>');const doc=dom.window.document;let resolveSecond, reads=0;
  const result={gallery:'IDFOLHA',page:1,rows:[],hasMore:false,filterOptions:{FORNECEDOR:['JOSÉ'],MESREFERENCIA:['09/2026','10/2026']}};
  const gallery=createHrPayrollGallery({document:doc,gallery:'IDFOLHA',request:async()=>{
    if(++reads===2) return new Promise(resolve=>{resolveSecond=resolve;});return result;
  }});
  t.after(()=>{gallery.destroy();dom.window.close();});await gallery.open();
  doc.querySelector('[data-action=toggle-payroll-filters]').click();
  const supplier=doc.querySelector('[name=FORNECEDOR]');supplier.value='JOSÉ';supplier.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  const month=doc.querySelector('[name=MESREFERENCIA]'), field=month.parentElement.querySelector('.sfs');
  field.querySelector('.sfs-trigger').click();
  const list=field.querySelector('[role=listbox]'), popup=field.querySelector('.sfs-popup');assert.equal(popup.hidden,false);
  resolveSecond(result);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(popup.hidden,false,'finishing the prior request must not interrupt month selection');
  const october=[...list.querySelectorAll('[role=option]')].find(node=>node.textContent==='10/2026');october.click();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(month.value,'10/2026');
});

test('each gallery has a search toolbar and filters for its displayed columns', async t => {
  for (const name of ['IDFOLHA','FOLHAPGTO']) {
    const dom = new JSDOM('<main></main>'); const doc=dom.window.document; const calls=[];
    const gallery=createHrPayrollGallery({document:doc,gallery:name,request:async(...args)=>{
      calls.push(args); return {gallery:name,page:args[1],rows:[],hasMore:false,count:0,
        filterOptions:{FORNECEDOR:['CLEITON'],TIPOPGTO:['SALÁRIO'],MESREFERENCIA:['09/2026']}};
    }});
    t.after(()=>{gallery.destroy();dom.window.close();}); await gallery.open();
    const toolbar=doc.querySelector('.hr-gallery-toolbar');
    assert.ok(toolbar?.querySelector('input[type=search]'));
    const toggle=toolbar.querySelector('[data-action=toggle-payroll-filters]');
    assert.equal(toggle.getAttribute('aria-expanded'),'false'); toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'true');
    const expected=name==='IDFOLHA' ? ['id','FORNECEDOR','MESREFERENCIA']
      : ['id','FORNECEDOR','TIPOPGTO','VALORUNITARIOmin','VALORUNITARIOmax','QTDmin','QTDmax','DATAfrom','DATAto','IDFOLHA','IDLANCAMENTO'];
    for(const key of expected) assert.ok(doc.querySelector(`[name="${key}"]`),key);
    const supplier=doc.querySelector('[name=FORNECEDOR]');
    assert.equal(supplier.tagName,'SELECT'); supplier.value='CLEITON';
    supplier.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.at(-1)[1],1);
    assert.equal(calls.at(-1)[4].filters.FORNECEDOR,'CLEITON');
    doc.querySelector('[data-action=clear-payroll-filters]').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.at(-1)[4].filters.FORNECEDOR,'');
  }
});
