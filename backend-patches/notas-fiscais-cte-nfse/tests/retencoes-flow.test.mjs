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
for(const name of ['build-flows.mjs','build-live-flows.mjs','build-retention-flow.mjs','danfe-flow.mjs','retention-provision-flow.mjs']) fs.copyFileSync(path.join(source,'scripts',name),path.join(fixture,'scripts',name));
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
  for(const name of ['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO','CONTRIB_SOCIAIS_RETIDAS','TOTAL_RETIDO']){
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
  assert.deepEqual(Object.keys(actions.Campos.inputs).sort(),['STATUS_RETENCOES','PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO','CONTRIB_SOCIAIS_RETIDAS','TOTAL_RETIDO'].sort());
  const incoming={STATUS_RETENCOES:'RETENCAO_INFORMADA_XML',PIS_RETIDO:null,COFINS_RETIDA:null,CSLL_RETIDA:null,IRRF_RETIDO:null,INSS_RETIDO:null,ISS_RETIDO:null,CONTRIB_SOCIAIS_RETIDAS:13.02,TOTAL_RETIDO:13.02};
  const evaluated=Object.fromEntries(Object.entries(actions.Campos.inputs).map(([name,expression])=>[name,evaluate(expression,{items:{Atualizacoes:{fields:incoming}}})]));
  assert.deepEqual(JSON.parse(evaluate(patch['parameters/body'],{outputs:{Campos:evaluated}})),incoming);
  assert.ok(!JSON.stringify(flow).includes('Files/add'));
  assert.ok(!JSON.stringify(flow).includes('VALOR_LIQUIDO'));
});

test('helper de retencoes aceita somente NF-e55 e NFS-e50 validadas antes de consulta ou escrita',()=>{
  const flow=read('06-Atualizar-Retencoes.definition.json'),a=flow.actions.Atualizacoes.actions;
  const schema=flow.triggers.manual.inputs.schema;
  assert.equal(schema.properties.updates.items.properties.key.minLength,44);
  assert.equal(schema.properties.updates.items.properties.key.maxLength,50);
  assert.equal(a.Localizar_nota.runAfter.Conferir_identidade[0],'Succeeded');
  assert.equal(a.Campos.runAfter.Conferir_tipo[0],'Succeeded');
  const nfe='31261012345678000123550010000001231000001234',nfse='1'.repeat(50);
  const identity=key=>evaluate(a.Conferir_identidade.inputs.content,{items:{Atualizacoes:{key}}});
  for(const key of [nfe,nfe.slice(0,6)+'12ABC6780001'+nfe.slice(18),nfse])assert.deepEqual(identity(key),{valid:true});
  for(const key of [nfe+'1',nfse.slice(0,-1),nfe.replace('55','57'),"'"+nfse.slice(1),nfe.slice(0,6)+'12abc6780001'+nfe.slice(18)])assert.deepEqual(identity(key),{});
  const stored=(key,row)=>evaluate(a.Conferir_tipo.inputs.content,{items:{Atualizacoes:{key}},body:{Localizar_nota:{d:{results:[row]}}}});
  assert.deepEqual(stored(nfe,{CHAVE_ACESSO:nfe,TIPO_FISCAL:'NF-e',MODELO:'55'}),{valid:true});
  assert.deepEqual(stored(nfse,{CHAVE_ACESSO:nfse,TIPO_FISCAL:'NFS-e',MODELO:'NFS-e'}),{valid:true});
  for(const row of [{CHAVE_ACESSO:nfse,TIPO_FISCAL:'CT-e'}, {CHAVE_ACESSO:nfe,TIPO_FISCAL:'NFS-e'}])assert.deepEqual(stored(nfse,row),{});
  assert.deepEqual(stored(nfe,{CHAVE_ACESSO:nfe,TIPO_FISCAL:'CT-e',MODELO:'57'}),{});
});

test('reanalise NFS-e limpa componentes antigos sem somar novamente o agregado ao total explicito',()=>{
  const fields=read('03-Receber-NFe.definition.json').actions.Documentos.actions.Campos_finais.inputs;
  const context={outputs:{Existente:{PIS_RETIDO:1.82,COFINS_RETIDA:8.40,CSLL_RETIDA:13.02},Novos_campos:{STATUS_IMPORTACAO:'XML_COMPLETO',TIPO_FISCAL:'NFS-e',CONTRIB_SOCIAIS_RETIDAS:13.02,TOTAL_RETIDO:13.02}}};
  for(const name of ['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA'])assert.equal(evaluate(fields[name],context),null);
  assert.equal(evaluate(fields.CONTRIB_SOCIAIS_RETIDAS,context),13.02);
  assert.equal(evaluate(fields.TOTAL_RETIDO,context),13.02);
});
