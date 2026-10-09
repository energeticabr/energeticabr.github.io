import test from 'node:test';
import assert from 'node:assert/strict';
const columns=[{name:'Title',displayName:'CADASTRO'},{name:'LinkTitle',displayName:'CADASTRO'},{name:'Contractor',displayName:'EMPREITEIRO'},{name:'State',displayName:'STATUS'}];
const item=(id,name,contractor='SIM',status='ATIVO')=>({id,fields:{Title:name,Contractor:contractor,State:status}});
const source=async({pages,metadata=columns}={})=>{
 const {createRhidMonthlyData}=await import('../src/chat/rhid-monthly-data.js');
 let n=0;
 return createRhidMonthlyData({repository:{resolveList:async(site,names)=>{assert.equal(site,'personal');assert.deepEqual(names,['FORNECEDORES']);return {status:'resolved',id:'suppliers'};},getColumns:async()=>metadata,getItemsPage:async()=>pages[n++]}});
};
test('supplier options use CADASTRO and require both EMPREITEIRO SIM and STATUS ATIVO across pages',async()=>{
 const data=await source({pages:[{items:[item('1','Inativo','SIM','INATIVO'),item('2','Não empreiteiro','NÃO')],hasMore:true,nextLink:'next'},{items:[item('3','BETA'),item('4','ALFA',' sim ',' ativo ')],hasMore:false}]});
 assert.deepEqual(await data.loadSuppliers(),[{id:'4',name:'ALFA'},{id:'3',name:'BETA'}]);
});
test('supplier options refuse ambiguous metadata, names and incomplete pagination',async()=>{
 for(const args of [
  {metadata:[...columns,{name:'Another',displayName:'CADASTRO'}],pages:[]},
  {pages:[{items:[item('1','José'),item('2','JOSE')],hasMore:false}]},
  {pages:[{items:[],hasMore:true,nextLink:'next'}]},
  {pages:[{items:[item('1','José')],hasMore:false,partial:true}]},
 ]){const data=await source(args);await assert.rejects(data.loadSuppliers(),/ambígu|incomplet|pagina/i);}
});
test('supplier query rejects an already cancelled request',async()=>{
 const controller=new AbortController();controller.abort();const data=await source({pages:[]});await assert.rejects(data.loadSuppliers({signal:controller.signal}),{name:'AbortError'});
});
