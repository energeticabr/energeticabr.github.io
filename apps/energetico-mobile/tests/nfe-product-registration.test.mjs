import test from 'node:test';
import assert from 'node:assert/strict';
import { createNfeProductRegistration } from '../src/chat/nfe-product-registration.js';

function fixture() {
  const rows = [], writes = [];
  let loseResponse = false, authorizations = 0;
  const columns = ['Title','field_1','UNIDADE','TIPO','TIPODESPESA','GERADESEMBOLSO','SATUS'].map(name => ({name}));
  const repo = {
    resolveList:async (_site,[name])=>({status:'resolved',id:name}),
    getColumns:async ()=>columns,
    getItems:async (_site,list)=>list === 'CADASTROPRODUTO' ? rows : list === 'CADASTROTIPOMATERIAL'
      ? [{id:'3',fields:{TIPO:'MATERIAL'}}] : [
        {id:'1',fields:{field_1:'METAL',field_3:'CUSTO',STATUS:'ATIVO'}},
        {id:'2',fields:{field_1:'RECEITA',field_3:'RECEITA'}},
      ],
    createItem:async (site,list,fields)=>{
      writes.push({site,list,fields});
      const row={id:'99',fields}; rows.push(row);
      if(loseResponse) throw new Error('resposta perdida');
      return row;
    },
  };
  const service = createNfeProductRegistration({repository:repo,authorizeWrite:async()=>{authorizations++;}});
  const values={name:'PISO METÁLICO',subfamilyId:'1',unit:'PC',expenseType:'MATERIAL',disburses:'SIM'};
  return {service,rows,writes,values,columns,lose:()=>{loseResponse=true;},get authorizations(){return authorizations;}};
}
test('registers in the real product catalog with the subfamily classification',async()=>{
  const h=fixture(), context=await h.service.load();
  assert.deepEqual(context.subfamilies.map(x=>x.id),['1']);
  const product=await h.service.save(context,h.values);
  assert.deepEqual(product,{id:'99',label:'PISO METÁLICO',unit:'PC',expenseType:'MATERIAL',disburses:'SIM'});
  assert.deepEqual(h.writes,[{site:'personal',list:'CADASTROPRODUTO',fields:{Title:'METAL',field_1:'PISO METÁLICO',UNIDADE:'PC',TIPO:'CUSTO',TIPODESPESA:'MATERIAL',GERADESEMBOLSO:'SIM',SATUS:'ATIVO'}}]);
  assert.equal(h.authorizations,1);
});
test('rejects missing, forged and invalid fields without writing',async()=>{
  const h=fixture(), context=await h.service.load();
  for(const values of [{...h.values,name:''},{...h.values,subfamilyId:'2'},{...h.values,expenseType:'forged'},{...h.values,disburses:'forged'},{...h.values,unit:''}])
    await assert.rejects(h.service.save(context,values));
  await assert.rejects(h.service.save({...context},h.values));
  assert.equal(h.writes.length,0);
});
test('a lost create response is reconciled on retry without another POST',async()=>{
  const h=fixture(), context=await h.service.load(); h.lose();
  await assert.rejects(h.service.save(context,h.values),/resposta perdida/);
  const product=await h.service.save(context,h.values);
  assert.equal(product.id,'99'); assert.equal(h.writes.length,1);
});
test('does not reuse a conflicting existing product or submit twice concurrently',async()=>{
  const h=fixture(), context=await h.service.load();
  const [a,b]=await Promise.all([h.service.save(context,h.values),h.service.save(context,h.values)]);
  assert.equal(a.id,b.id); assert.equal(h.writes.length,1);
  await assert.rejects(h.service.save(context,{...h.values,unit:'KG'}),/cadastrado/i);
});
test('retry reconciliation distinguishes square and cubic units',async()=>{
  const h=fixture(), context=await h.service.load();
  await h.service.save(context,{...h.values,unit:'m²'});
  await assert.rejects(h.service.save(context,{...h.values,unit:'m³'}),/cadastrado/i);
  assert.equal(h.writes.length,1);
});
