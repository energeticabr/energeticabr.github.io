import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {evaluate} from './wdl.mjs';

test('retencoes sao valores proprios e atualizacao completa limpa ausencias sem regredir em resumo',()=>{
  execFileSync(process.execPath,['scripts/build-flows.mjs']);
  execFileSync(process.execPath,['scripts/build-live-flows.mjs']);
  const schema=JSON.parse(fs.readFileSync('powerautomate/schema-sharepoint.json'));
  const flow=JSON.parse(fs.readFileSync('powerautomate/03-Receber-NFe.definition.json'));
  const fields=flow.actions.Documentos.actions.Campos_finais.inputs;
  for(const name of ['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO']){
    assert.equal(schema.fields.find(field=>field.name===name)?.type,'Currency');
    for(const incoming of [{STATUS_IMPORTACAO:'RESUMO_AGUARDANDO_XML'},{STATUS_IMPORTACAO:'EVENTO_SEM_XML'}]) assert.equal(evaluate(fields[name],{outputs:{Existente:{STATUS_IMPORTACAO:'XML_COMPLETO',[name]:110},Novos_campos:incoming}}),110);
    assert.equal(evaluate(fields[name],{outputs:{Existente:{[name]:110},Novos_campos:{STATUS_IMPORTACAO:'XML_COMPLETO'}}}),null);
    assert.equal(evaluate(fields[name],{outputs:{Existente:{[name]:110},Novos_campos:{STATUS_IMPORTACAO:'XML_COMPLETO',[name]:0}}}),0);
  }
  assert.equal(schema.fields.find(field=>field.name==='STATUS_RETENCOES')?.type,'Text');
});

test('carga de retencoes altera somente metadados de uma nota existente',()=>{
  const flow=JSON.parse(fs.readFileSync('powerautomate/06-Atualizar-Retencoes.definition.json'));
  const actions=flow.actions.Atualizacoes.actions;
  assert.equal(actions.Conferir_unica.type,'ParseJson');
  assert.deepEqual(actions.Conferir_unica.inputs.schema.enum,[1]);
  const patch=actions.Atualizar.inputs.parameters;
  assert.equal(patch['parameters/headers']['X-HTTP-Method'],'MERGE');
  assert.ok(patch['parameters/headers']['IF-MATCH'].includes('etag'));
  assert.equal(patch['parameters/body'],"@string(outputs('Campos'))",'serializa valores numericos/null depois de avaliar as expressoes');
  assert.deepEqual(Object.keys(actions.Campos.inputs).sort(),['STATUS_RETENCOES','PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO'].sort());
  const incoming={STATUS_RETENCOES:'RETENCAO_INFORMADA_XML',PIS_RETIDO:null,COFINS_RETIDA:0,CSLL_RETIDA:null,IRRF_RETIDO:15,INSS_RETIDO:110,ISS_RETIDO:null};
  const evaluated=Object.fromEntries(Object.entries(actions.Campos.inputs).map(([name,expression])=>[name,evaluate(expression,{items:{Atualizacoes:{fields:incoming}}})]));
  assert.deepEqual(JSON.parse(evaluate(patch['parameters/body'],{outputs:{Campos:evaluated}})),incoming);
  assert.ok(!JSON.stringify(flow).includes('Files/add'));
  assert.ok(!JSON.stringify(flow).includes('VALOR_LIQUIDO'));
});
