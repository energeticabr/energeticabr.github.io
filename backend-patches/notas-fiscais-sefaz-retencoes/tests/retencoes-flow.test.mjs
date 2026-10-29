import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {evaluate} from './wdl.mjs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Run the overlay contract in an isolated fixture, including when the portal
// discovers this file from another working directory. No tenant config is read.
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tempBase=path.resolve(tmpdir());
const fixture=fs.mkdtempSync(path.join(tempBase,'sefaz-retention-contract-'));
after(()=>{
  const target=path.resolve(fixture);
  if(path.dirname(target)!==tempBase || !path.basename(target).startsWith('sefaz-retention-contract-')) throw new Error('Unsafe fixture cleanup path');
  fs.rmSync(target,{recursive:true,force:true});
});
for(const dir of ['config','scripts','powerautomate']) fs.mkdirSync(path.join(fixture,dir));
for(const name of ['build-flows.mjs','build-live-flows.mjs','build-retention-flow.mjs','danfe-flow.mjs']) fs.copyFileSync(path.join(source,'scripts',name),path.join(fixture,'scripts',name));
fs.writeFileSync(path.join(fixture,'config/energetica.json'),JSON.stringify({
  companyCnpj:'00000000000000',siteUrl:'https://example.sharepoint.com/sites/fixture',
  queueSiteUrl:'https://example-my.sharepoint.com/personal/fixture',listTitle:'NOTAS_FISCAIS_SEFAZ',
  libraryTitle:'DOCUMENTOS_FISCAIS_SEFAZ',libraryPath:'/sites/fixture/DOCUMENTOS_FISCAIS_SEFAZ',
  queueListTitle:'SEFAZ_COLETA_FILA',minimumIssueDate:'2026-10-01',desktopFlowId:'FICTICIO',desktopRunMode:'attended',
  scheduleTimeZone:'E. South America Standard Time',scheduleHours:[9,15,20],scheduleMinutes:[0],
}));
for(const script of ['build-flows.mjs','build-live-flows.mjs','build-retention-flow.mjs']) execFileSync(process.execPath,[path.join(fixture,'scripts',script)],{cwd:fixture});
const read=name=>JSON.parse(fs.readFileSync(path.join(fixture,'powerautomate',name)));

test('retencoes sao valores proprios e atualizacao completa limpa ausencias sem regredir em resumo',()=>{
  const schema=read('schema-sharepoint.json');
  const flow=read('03-Receber-NFe.definition.json');
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
  const flow=read('06-Atualizar-Retencoes.definition.json');
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
