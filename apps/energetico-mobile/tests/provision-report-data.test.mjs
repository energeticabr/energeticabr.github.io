import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpendingReportsData } from '../src/chat/spending-reports-data.js';
import * as model from '../src/chat/provision-report-model.js';

// Break: the report never fetches DESCRITIVOPROVISAO, reads only its first
// page, or repeats an item from a pagination boundary in the displayed total.
test('provision snapshot reads complete parent metadata and child links without financial writes',async()=>{
  const reads=[];
  const repository={
    async resolveList(site,aliases){assert.equal(site,'personal');reads.push(aliases[0]);return {status:'resolved',id:aliases[0]};},
    async getColumns(_site,list){return list==='PROVISÃO PGTOS'?[{name:'parent_ref',displayName:'DESCRITIVOPROVISAO',text:{}}]:[];},
    async getItemsPage(_site,list,query,options){
      assert.equal(new URLSearchParams(query).get('$expand'),'fields');
      if(list==='DESPESASRECORRENTES')return {items:[],hasMore:false};
      if(list==='DESCRITIVOPROVISAO')return options.cursor
        ?{items:[{id:'43',fields:{FILIAL:'Mesmo nome',FORNECEDOR:'Referência',DATAPREVISTOPGTO:'2026-11-01'}}],hasMore:false}
        :{items:[{id:'42',fields:{FILIAL:'Mesmo nome',FORNECEDOR:'Referência',DATAPREVISTOPGTO:'2026-10-20',VALORTOTAL:999}}],hasMore:true,nextLink:'parents-next'};
      const first={id:'301',fields:{parent_ref:'42',PRODUTO:'Água',VALORTOTAL:'0,10',QTD:1,STATUS:'PAGAMENTO PREVISTO'}};
      return options.cursor?{items:[first,{id:'302',fields:{parent_ref:'42',PRODUTO:'Internet',VALORTOTAL:'0,20',QTD:1,STATUS:'PAGAMENTO PREVISTO'}}],hasMore:false}
        :{items:[first],hasMore:true,nextLink:'children-next'};
    },
    async updateItem(){assert.fail('a report must never write records');},
    async createItem(){assert.fail('a report must never create records');},
  };
  const snapshot=await createSpendingReportsData({repository}).loadProvisionReportSnapshot();
  assert.deepEqual(reads.sort(),['DESCRITIVOPROVISAO','DESPESASRECORRENTES','PROVISÃO PGTOS']);
  assert.deepEqual(snapshot.descriptions.map(row=>row.id),['42','43']);
  assert.deepEqual(snapshot.provisions.map(row=>row.descriptionId),['42','42']);
  assert.equal(Object.isFrozen(snapshot.descriptions),true);
  const report=model.buildProvisionReport(snapshot);
  assert.equal(report.pendingCount,2);assert.equal(report.pendingTotal,0.3);
  const groups=model.groupProvisionReportRows(report.rows,snapshot.descriptions);
  assert.equal(groups.length,1);assert.equal(groups[0].total,0.3);assert.equal(groups[0].dueDate,'2026-10-20');
});

test('provision snapshot rejects incomplete parent pagination and cancelled reads',async()=>{
  const repository={
    async resolveList(_site,aliases){return {status:'resolved',id:aliases[0]};},
    async getColumns(){return [];},
    async getItemsPage(_site,list){return list==='DESCRITIVOPROVISAO'?{items:[],hasMore:true}:{items:[],hasMore:false};},
  };
  await assert.rejects(createSpendingReportsData({repository}).loadProvisionReportSnapshot(),/paginação.*próxima página/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(createSpendingReportsData({repository}).loadProvisionReportSnapshot({signal:controller.signal}),{name:'AbortError'});
});

test('report attachment reads and downloads use the matching SharePoint list even when item IDs overlap',async()=>{
  const requests=[];
  const repository={
    async resolveList(_site,aliases){return {status:'resolved',id:aliases[0]};},
    async listAttachments(site,list,id,{requireCollection}){
      assert.equal(requireCollection,true);
      requests.push([site,list,id]);
      return [{name:list==='DESCRITIVOPROVISAO'?'descritivo.pdf':'provisao.pdf',type:'application/pdf'}];
    },
    async downloadAttachment(site,list,id,fileName){
      requests.push([site,list,id,fileName]);
      return new TextEncoder().encode('%PDF-1.7').buffer;
    },
  };
  const data=createSpendingReportsData({repository});
  for(const [kind,fileName] of [['description','descritivo.pdf'],['provision','provisao.pdf']]){
    assert.deepEqual(await data.listProvisionReportAttachments(kind,'42'),[{fileName,mimeType:'application/pdf'}]);
    const file=await data.downloadProvisionReportAttachment(kind,'42',fileName);
    assert.equal(file.type,'application/pdf');assert.equal(await file.text(),'%PDF-1.7');
  }
  assert.deepEqual(requests,[['personal','DESCRITIVOPROVISAO','42'],['personal','DESCRITIVOPROVISAO','42','descritivo.pdf'],
    ['personal','PROVISÃO PGTOS','42'],['personal','PROVISÃO PGTOS','42','provisao.pdf']]);
});
