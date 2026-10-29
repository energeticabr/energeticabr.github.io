import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {evaluate} from './wdl.mjs';
import {createFlowFixture} from './flow-fixture.mjs';
const fixture=createFlowFixture('contract');after(()=>fixture.cleanup());fixture.build();
const root=fixture.root;
const collectionActions=s=>s.actions.Janela_de_coleta?.actions??s.actions;
test('fila de coleta usa o corte fixo de outubro e preserva os tres horarios',()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-live-flows.mjs')]);
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/energetica.json')));
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/05-Agendar-Coleta.definition.json')));
  const body=s.actions.Garantir_job.actions.Criar_job.inputs.parameters['parameters/body'];
  assert.ok(body.includes(`'START_DATE','${cfg.minimumIssueDate}T00:00:00-03:00'`));
  assert.ok(!body.includes('addDays(utcNow(),-90)'));
  assert.deepEqual(s.triggers.Recorrencia.recurrence.schedule.hours,[9,15,20]);
});
test('DANFE e anexo do item e so e disponibilizado apos gravacao',()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-flows.mjs')]);
  execFileSync(process.execPath,[path.join(root,'scripts/build-live-flows.mjs')]);
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/03-Receber-NFe.definition.json')));
  const a=s.actions.Documentos.actions;
  assert.ok(a.Conferir_DANFE,'XML completo exige PDF antes do ack');
  assert.deepEqual(a.Gravar_XML.runAfter,{Conferir_DANFE:['Succeeded']});
  assert.deepEqual(a.Nota_apos_gravacao.runAfter,{Criar_ou_atualizar:['Succeeded']});
  const pdf=a.Anexar_DANFE;
  assert.equal(evaluate(pdf.expression.equals[0],{items:{Documentos:{kind:'resNFe'}}}),false);
  assert.equal(evaluate(pdf.expression.equals[0],{items:{Documentos:{kind:'nfeProc'}}}),true);
  assert.equal(pdf.expression.equals[1],true);
  const ctx={items:{Documentos:{danfe:{fileName:'DANFE-teste.pdf',pdfBase64:'JVBERi0xLjQK'}}},outputs:{Nota_gravada:{Id:42}}};
  const write=pdf.actions.Criar_ou_substituir_anexo;
  assert.equal(write.actions.Criar_anexo.inputs.host.operationId,'CreateAttachment','upload deve usar parametro binario nativo');
  assert.equal(evaluate(write.actions.Criar_anexo.inputs.parameters.itemId,ctx),42);
  assert.equal(write.else.actions.Substituir_anexo.inputs.host.operationId,'UpdateFile','retry substitui arquivo sem excluir anexo');
  assert.deepEqual(write.else.actions.Substituir_anexo.runAfter,{Metadados_anexo:['Succeeded']});
  const bytes=Buffer.from([0x25,0x50,0x44,0x46,0xff,0,0x81]);
  ctx.items.Documentos.danfe.pdfBase64=bytes.toString('base64');
  assert.deepEqual(evaluate(write.actions.Criar_anexo.inputs.parameters.body,ctx),bytes);
  assert.deepEqual(evaluate(write.else.actions.Substituir_anexo.inputs.parameters.body,ctx),bytes);
  assert.deepEqual(pdf.actions.Conferir_anexo.runAfter,{Criar_ou_substituir_anexo:['Succeeded']});
  assert.equal(pdf.actions.Baixar_pdf.inputs.host.operationId,'GetFileContentByPath');
  const good={...ctx,body:{Baixar_pdf:{$content:bytes.toString('base64')}}};
  const bad={...ctx,body:{Baixar_pdf:{$content:Buffer.from('arquivo alterado').toString('base64')}}};
  assert.deepEqual(evaluate(pdf.actions.Conferir_integridade_pdf.inputs.content,good),{valido:true});
  assert.deepEqual(evaluate(pdf.actions.Conferir_integridade_pdf.inputs.content,bad),{});
  assert.deepEqual(pdf.actions.Nota_apos_anexo.runAfter,{Conferir_integridade_pdf:['Succeeded']});
  assert.ok(pdf.actions.Campos_DANFE,'metadados precisam resolver expressoes antes de serializar JSON');
  assert.deepEqual(pdf.actions.Campos_DANFE.runAfter,{Nota_apos_anexo:['Succeeded']});
  const metadata=pdf.actions.Campos_DANFE.inputs;
  const url=evaluate(metadata.DANFE_URL.Url,{body:{Conferir_anexo:{ServerRelativeUrl:'/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ/Attachments/42/DANFE-teste.pdf'}}});
  assert.equal(url,'https://example.sharepoint.com/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ/Attachments/42/DANFE-teste.pdf');
  const payload=JSON.parse(evaluate(pdf.actions.Marcar_DANFE.inputs.parameters['parameters/body'],{outputs:{Campos_DANFE:{STATUS_DANFE:metadata.STATUS_DANFE,DANFE_URL:{Url:url,Description:metadata.DANFE_URL.Description}}}}));
  assert.equal(payload.STATUS_DANFE,'DISPONIVEL');
  assert.equal(payload.DANFE_URL.Url,url);
  assert.deepEqual(s.actions.Ids_confirmados.runAfter,{Documentos:['Succeeded']});
});
test('replay de resumo evento ou XML retira metadados readonly dos links SharePoint',()=>{
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/02-Sincronizar-NFe.definition.json')));
  const a=collectionActions(s).Documentos.actions;
  const oldLink={__metadata:{type:'SP.FieldUrlValue'},Url:'https://energeticaltda.sharepoint.com/sites/energetica/nota.pdf',Description:'Espelho'};
  for(const kind of ['nfeProc','resNFe','procEventoNFe','resEvento']){
    const doc={kind,fileName:'nota.xml'};
    const ctx={items:{Documentos:doc},outputs:{Novos_campos:{},Existente:{XML_URL:oldLink,DANFE_URL:oldLink,STATUS_DANFE:'DISPONIVEL'}}};
    const danfe=evaluate(a.Campos_finais.inputs.DANFE_URL,ctx);
    assert.deepEqual(danfe,{Url:oldLink.Url,Description:'Espelho'},kind);
    const xml=evaluate(a.Campos_finais.inputs.XML_URL,ctx);
    assert.equal(xml.__metadata,undefined,kind);
    if(kind!=='nfeProc')assert.equal(xml.Url,oldLink.Url,kind);
    assert.equal(evaluate(a.Campos_finais.inputs.STATUS_DANFE,ctx),'DISPONIVEL',kind);
  }
});
test('fontes de fluxos conservam contratos de escrita e ack',()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-flows.mjs')]);
  const p=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/01-Provisionar-SharePoint.definition.json')));
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/02-Sincronizar-NFe.definition.json')));
  // Percorre dependencias, evita acao pulada ou nome inexistente sem testar o framework Microsoft.
  function check(actions,ancestors=new Set()){
    const known=new Set([...ancestors,...Object.keys(actions)]);
    for(const [name,a] of Object.entries(actions)){
      for(const dep of Object.keys(a.runAfter??{}))assert.ok(known.has(dep),`${name}: dependencia ${dep} inexistente`);
      if(a.actions)check(a.actions,known);
      if(a.else?.actions)check(a.else.actions,known);
    }
  }
  check(p.actions);check(s.actions);
  assert.equal(s.triggers.Recorrencia.runtimeConfiguration.concurrency.runs,1);
  assert.deepEqual(s.triggers.Recorrencia.recurrence,{
    frequency:'Day',interval:1,timeZone:'E. South America Standard Time',
    schedule:{hours:[9,15,20],minutes:[0]},
  });
  const collection=collectionActions(s);
  assert.equal(collection.Documentos.runtimeConfiguration.concurrency.repetitions,1);
  const a=collection.Documentos.actions;
  assert.equal(a.Confirmar_desktop,undefined,'ack nao deve iniciar uma sessao por documento');
  const batchAck=collection.Confirmar_lote.actions;
  assert.deepEqual(collection.Confirmar_lote.runAfter,{Documentos:['Succeeded']});
  assert.deepEqual(batchAck.Confirmar_desktop.runAfter,{Ids_processados:['Succeeded']});
  assert.deepEqual(a.Localizar_nota.runAfter,{Gravar_XML:['Succeeded']});
  assert.equal(a.Atualizar_nota,undefined);
  assert.equal(evaluate(a.Criar_ou_atualizar.else.actions.Atualizar_nota.inputs.parameters['parameters/headers']['IF-MATCH'],{outputs:{Existente:{__metadata:{etag:'"7"'}}}}),'"7"');
  const schema=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/schema-sharepoint.json')));
  for(const field of ['VALOR_TOTAL_NOTA','DESCONTOS','VALOR_LIQUIDO','CNPJ_FORNECEDOR','XML_URL'])assert.ok(schema.fields.some(f=>f.name===field));
});
test('expressoes WDL produzem consultas OData validas e preservam nota completa/cancelada',()=>{
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/02-Sincronizar-NFe.definition.json')));
  const collection=collectionActions(s);
  const a=collection.Documentos.actions;
  const key='31261012345678000123550010000001231000001234';
  const doc={key,id:'000000000000002-1234567890abcdef',fileName:'exemplo.xml',kind:'resNFe',fields:{CHAVE_ACESSO:key,STATUS_IMPORTACAO:'RESUMO_AGUARDANDO_XML',ULTIMO_NSU:'000000000000002',VALOR_TOTAL_NOTA:950}};
  const context={items:{Documentos:doc},outputs:{Novos_campos:doc.fields,Existente:{Id:42,__metadata:{etag:'"7"'},CHAVE_ACESSO:key,Title:'Fornecedor completo',STATUS_IMPORTACAO:'XML_COMPLETO',SITUACAO:'CANCELADA',ULTIMO_NSU:'000000000000003',VALOR_TOTAL_NOTA:950,DESCONTOS:100,VALOR_LIQUIDO:930,XML_URL:{Url:'https://example.test/nota.xml',Description:'Original'}}}};
  assert.equal(evaluate(a.Localizar_nota.inputs.parameters['parameters/uri'],context),`_api/web/lists/getbytitle('NOTAS_FISCAIS_SEFAZ')/items?$select=*&$filter=CHAVE_ACESSO eq '${key}'&$top=1`);
  assert.equal(evaluate(a.Criar_ou_atualizar.else.actions.Atualizar_nota.inputs.parameters['parameters/uri'],context),"_api/web/lists/getbytitle('NOTAS_FISCAIS_SEFAZ')/items(42)");
  const merged=Object.fromEntries(Object.entries(a.Campos_finais.inputs).map(([k,v])=>[k,evaluate(v,context)]));
  assert.equal(merged.Title,'Fornecedor completo');
  assert.equal(merged.DESCONTOS,100);
  assert.equal(merged.VALOR_LIQUIDO,930);
  assert.equal(merged.STATUS_IMPORTACAO,'XML_COMPLETO');
  assert.equal(merged.SITUACAO,'CANCELADA');
  assert.equal(merged.ULTIMO_NSU,'000000000000003');
  assert.equal(merged.XML_URL.Url,'https://example.test/nota.xml');
  const ackAction=collection.Confirmar_lote.actions.Confirmar_desktop;
  const ackContext={body:{Ids_processados:['000000000000002-1234567890abcdef','000000000000003-0123456789abcdef']}};
  const ack=JSON.parse(Buffer.from(evaluate(ackAction.inputs.parameters['item/PayloadBase64'],ackContext),'base64').toString('utf8'));
  assert.deepEqual(ack,{ids:['000000000000002-1234567890abcdef','000000000000003-0123456789abcdef']});
});
test('cada horario escoa lotes sem limitar o dia a trinta documentos',()=>{
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/02-Sincronizar-NFe.definition.json')));
  const loop=s.actions.Janela_de_coleta;
  assert.ok(loop,'o horario deve repetir lotes disponiveis');
  assert.equal(loop.type,'Until');
  assert.deepEqual(loop.runAfter,{Inicializar_coleta:['Succeeded']});
  assert.equal(evaluate(loop.expression,{variables:{ContinuarColeta:true}}),false);
  assert.equal(evaluate(loop.expression,{variables:{ContinuarColeta:false}}),true);
  const advance=loop.actions.Continuar_coleta;
  assert.deepEqual(advance.runAfter,{Confirmar_lote:['Succeeded']});
  assert.equal(evaluate(advance.inputs.value,{outputs:{Lote:{documents:[{id:'pendente'}]}}}),true);
  assert.equal(evaluate(advance.inputs.value,{outputs:{Lote:{documents:[],status:'COOLDOWN'}}}),false);
});
test('evento sem fornecedor deixa campo pendente em vez de usar chave',()=>{
  const s=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/02-Sincronizar-NFe.definition.json')));
  const fields=collectionActions(s).Documentos.actions.Campos_finais.inputs;
  const context={outputs:{Existente:{},Novos_campos:{CHAVE_ACESSO:'31261012345678000123550010000001231000001234',STATUS_IMPORTACAO:'EVENTO_SEM_XML'}},items:{Documentos:{key:'31261012345678000123550010000001231000001234'}}};
  assert.equal(evaluate(fields.Title,context),null);
  assert.equal(evaluate(fields.DESCONTOS,context),null);
});
