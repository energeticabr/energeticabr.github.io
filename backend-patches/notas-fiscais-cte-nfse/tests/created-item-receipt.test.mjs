import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from './wdl.mjs';
import {createFlowFixture} from './flow-fixture.mjs';
import fs from 'node:fs';
const fixture=createFlowFixture('created-ids');after(()=>fixture.cleanup());fixture.build();
const receiver=fixture.read('03-Receber-NFe.definition.json');
test('receipt records only successful native creation IDs after document delivery',()=>{
  assert.deepEqual(receiver.actions.Inicializar_ids_criados.inputs.variables,[{name:'CreatedItemIds',type:'array',value:[]}]);
  assert.deepEqual(receiver.actions.Documentos.runAfter,{Inicializar_ids_criados:['Succeeded']});
  assert.deepEqual(receiver.actions.Documentos.runtimeConfiguration.concurrency,{repetitions:1});
  const gate=receiver.actions.Documentos.actions.Confirmar_id_criado;
  assert.deepEqual(gate.runAfter,{Anexar_DANFE:['Succeeded']});
  const condition=gate.expression.equals[0];
  for(const kind of ['nfeProc','cteProc','NFSe']){
    assert.equal(evaluate(condition,{items:{Documentos:{kind}},body:{Localizar_nota:{d:{results:[]}}}}),true);
    assert.equal(evaluate(condition,{items:{Documentos:{kind}},body:{Localizar_nota:{d:{results:[{Id:99}]}}}}),false);
  }
  const append=gate.actions.Registrar_id_criado;
  assert.equal(append.type,'AppendToArrayVariable');
  assert.equal(append.inputs.name,'CreatedItemIds');
  assert.equal(evaluate(append.inputs.value,{body:{Criar_nota:{Id:42}},outputs:{Nota_gravada:{Id:999}}}),42);
  assert.deepEqual(gate.else.actions,{});
  assert.equal(receiver.actions.Recibo.inputs.createdItemIds,"@variables('CreatedItemIds')");
  assert.deepEqual(receiver.actions.Ids_confirmados.runAfter,{Documentos:['Succeeded']});
});
test('checked-in receiver and builder carry the same creation receipt contract',()=>{
  const checked=JSON.parse(fs.readFileSync(new URL('../powerautomate/03-Receber-NFe.definition.json',import.meta.url)));
  for(const name of ['Inicializar_ids_criados','Recibo'])assert.deepEqual(checked.actions[name],receiver.actions[name]);
  assert.deepEqual(checked.actions.Documentos.actions.Confirmar_id_criado,receiver.actions.Documentos.actions.Confirmar_id_criado);
  assert.deepEqual(checked.actions.Documentos.runAfter,receiver.actions.Documentos.runAfter);
});
