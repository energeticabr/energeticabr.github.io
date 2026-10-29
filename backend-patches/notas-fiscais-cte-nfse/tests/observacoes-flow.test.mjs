import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from './wdl.mjs';
import {createFlowFixture} from './flow-fixture.mjs';

test('observacoes sao colunas Note de texto simples e preservadas em replay',()=>{
  const fixture=createFlowFixture('observacoes');
  try {
  fixture.build();
  const schema=fixture.read('schema-sharepoint.json');
  const provision=fixture.read('01-Provisionar-SharePoint.definition.json');
  const flow=fixture.read('02-Sincronizar-NFe.definition.json');
  const fields=flow.actions.Janela_de_coleta.actions.Documentos.actions.Campos_finais.inputs;
  for(const name of ['OBSERVACOES_NOTA','INFORMACOES_FISCO']){
    assert.equal(schema.fields.find(field=>field.name===name)?.type,'Note');
    const create=provision.actions[`Garantir_${name}`].actions[`Criar_${name}`];
    assert.match(create.inputs.parameters['parameters/body'],/RichText=\\"FALSE\\"/);
    for(const kind of ['resNFe','procEventoNFe','resEvento']){
      assert.equal(evaluate(fields[name],{items:{Documentos:{kind}},outputs:{Existente:{STATUS_IMPORTACAO:'XML_COMPLETO',[name]:'Observações preservadas\nSegunda linha'},Novos_campos:{STATUS_IMPORTACAO:'EVENTO_SEM_XML'}}}),'Observações preservadas\nSegunda linha');
    }
    assert.equal(evaluate(fields[name],{outputs:{Existente:{},Novos_campos:{STATUS_IMPORTACAO:'XML_COMPLETO',[name]:'Texto completo'}}}),'Texto completo');
  }
  } finally {fixture.cleanup();}
});
