import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFlowFixture} from './flow-fixture.mjs';

const fixture=createFlowFixture();after(()=>fixture.cleanup());fixture.build();
const {evaluate}=await import(pathToFileURL(path.join(fixture.root,'tests/wdl.mjs')));
const provision=fixture.read('01-Provisionar-SharePoint.definition.json');
const receiver=fixture.read('03-Receber-NFe.definition.json');
const fields=fixture.read('schema-sharepoint.json').fields;
const actions=receiver.actions.Documentos.actions;
const full=['nfeProc','cteProc','cteOSProc','cteSimpProc','NFSe'];
const partial=['resNFe','procEventoNFe','resEvento','procEventoCTe','evento'];
const key44='31261012ABC678000123550010000001231000001234';
const key50='35503081212345678000123000000000123261000000000111';
const sha='a'.repeat(64);
function document(kind='NFSe',nsu='9223372036854775807'){
  const key=['NFSe','evento'].includes(kind)?key50:key44;
  const prefix=kind==='NFSe'?'DANFSe':kind.startsWith('cte')?'DACTE':'DANFE';
  const id=nsu+'-'+sha.slice(0,16);
  return {key,kind,nsu,id,sha256:sha,fileName:key+'-'+id+'.xml',xmlBase64:'PHhtbC8+',
    fields:{CHAVE_ACESSO:key,ULTIMO_NSU:nsu,STATUS_IMPORTACAO:full.includes(kind)?'XML_COMPLETO':'EVENTO_SEM_XML'},
    ...(full.includes(kind)?{danfe:{fileName:`${prefix}-${key}-${sha.slice(0,16)}.pdf`,pdfBase64:'JVBERi0xLjQK'.repeat(3),sha256:'b'.repeat(64)}}:{})};
}
const ctx=doc=>({items:{Documentos:doc}});
function validIdentity(doc){try{return evaluate(actions.Conferir_identidade.inputs.content,ctx(doc));}catch{return {};}}

test('chave existente e criada suporta64 caracteres mantendo unicidade indice e verificacao real',()=>{
  const create=JSON.parse(provision.actions.Garantir_CHAVE_ACESSO.actions.Criar_CHAVE_ACESSO.inputs.parameters['parameters/body']);
  assert.match(create.parameters.SchemaXml,/MaxLength="64"/);
  assert.match(create.parameters.SchemaXml,/EnforceUniqueValues="TRUE"/);
  const update=provision.actions.Atualizar_chave_unica.inputs.parameters;
  assert.deepEqual(JSON.parse(update['parameters/body']),{MaxLength:64,Indexed:true,EnforceUniqueValues:true,Required:true});
  assert.equal(update['parameters/headers']['X-HTTP-Method'],'MERGE');
  assert.match(provision.actions.Verificar_chave_unica.inputs.parameters['parameters/uri'],/MaxLength/);
  assert.deepEqual(provision.actions.Conferir_chave_unica.inputs.schema.properties.MaxLength.enum,[64]);
  assert.deepEqual(provision.actions.Habilitar_anexos.runAfter,{Conferir_chave_unica:['Succeeded']});
});

test('campos fiscais novos mantem tipos, data literal e conteudo Note sem rich text',()=>{
  for(const name of ['TIPO_FISCAL','ORIGEM_FISCAL','TOMADOR','CNPJ_TOMADOR','PAPEL_EMPRESA','MUNICIPIO_PRESTACAO','CODIGO_SERVICO','DATA_EMISSAO_DPS','SERIE_DPS'])assert.equal(fields.find(f=>f.name===name)?.type,'Text',name);
  assert.equal(fields.find(f=>f.name==='DESCRICAO_SERVICO')?.type,'Note');
  for(const name of ['ISS','VALOR_SERVICOS'])assert.equal(fields.find(f=>f.name===name)?.type,'Currency');
  assert.match(provision.actions.Garantir_DESCRICAO_SERVICO.actions.Criar_DESCRICAO_SERVICO.inputs.parameters['parameters/body'],/RichText=\\"FALSE\\"/);
  const doc=document();doc.fields.DATA_EMISSAO_ORIGINAL='2026-10-01T23:45:59-03:00';doc.fields.DATA_EMISSAO_DPS='2026-10-01T23:44:00-03:00';
  for(const name of ['DATA_EMISSAO_ORIGINAL','DATA_EMISSAO_DPS'])assert.equal(evaluate(actions.Campos_finais.inputs[name],{items:{Documentos:doc},outputs:{Novos_campos:doc.fields,Existente:{}}}),doc.fields[name]);
});

test('receiver autenticado aceita todos os kinds e valida chave50 e NSU int64 sem truncar',()=>{
  assert.equal(receiver.triggers.manual.kind,'Button');
  assert.deepEqual(receiver.actions.Validar_lote.inputs.schema.properties.documents.items.properties.kind.enum,[...full.slice(0,1),'resNFe','procEventoNFe','resEvento',...full.slice(1,4),'procEventoCTe','NFSe','evento']);
  for(const kind of [...full,...partial])assert.deepEqual(validIdentity(document(kind)),{valido:true},kind);
  const sample=document();assert.equal(sample.key.length,50);
  assert.equal(evaluate('@int(\'9223372036854775807\')'),9223372036854775807n);
  for(const mutate of [d=>d.nsu='9223372036854775808',d=>d.id='000000000000001-'+sha.slice(0,16),d=>d.fileName='../invoice.xml',d=>d.key='9'.repeat(49),d=>d.key="'".repeat(50),d=>d.sha256='g'.repeat(64),d=>d.fields.ULTIMO_NSU='000000000000001']){
    const invalid=document();mutate(invalid);assert.deepEqual(validIdentity(invalid),{});
  }
  assert.deepEqual(actions.Conferir_DANFE.runAfter,{Conferir_identidade:['Succeeded']});
  assert.deepEqual(actions.Gravar_XML.runAfter,{Conferir_DANFE:['Succeeded']});
});

test('todos os XMLs completos exigem PDF correto e anexos nativos; eventos e resumos pulam PDF',()=>{
  for(const kind of [...full,...partial]){
    const doc=document(kind);const expected=full.includes(kind);
    assert.equal(evaluate(actions.Conferir_DANFE.expression.equals[0],ctx(doc)),expected,kind);
    assert.equal(evaluate(actions.Anexar_DANFE.expression.equals[0],ctx(doc)),expected,kind);
    if(expected){
      assert.deepEqual(evaluate(actions.Conferir_DANFE.actions.Conferir_identidade_pdf.inputs.content,ctx(doc)),{valido:true},kind);
      const invalid=structuredClone(doc);invalid.danfe.fileName='DANFE-forged.pdf';
      assert.deepEqual(evaluate(actions.Conferir_DANFE.actions.Conferir_identidade_pdf.inputs.content,ctx(invalid)),{});
      assert.equal(actions.Conferir_DANFE.actions.Validar_pdf.inputs.schema.type,'object');
      const missing=structuredClone(doc);delete missing.danfe;
      assert.throws(()=>evaluate(actions.Conferir_DANFE.actions.Conferir_identidade_pdf.inputs.content,ctx(missing)),kind+' sem PDF falha antes de gravar XML');
      assert.deepEqual(actions.Conferir_DANFE.actions.Validar_pdf.inputs.schema.required,['fileName','pdfBase64','sha256']);
    }else assert.equal(doc.danfe,undefined);
  }
  const attach=actions.Anexar_DANFE.actions;
  assert.equal(attach.Criar_ou_substituir_anexo.actions.Criar_anexo.inputs.host.operationId,'CreateAttachment');
  assert.equal(attach.Criar_ou_substituir_anexo.else.actions.Substituir_anexo.inputs.host.operationId,'UpdateFile');
  assert.match(attach.Campos_DANFE.inputs.DANFE_URL.Description,/documento fiscal/i);
});

test('eventos nao apagam nota completa cancelada, valores, tipo e PDF; NSU19 continua exato',()=>{
  const incoming=document('evento','9223372036854775806');
  incoming.fields={...incoming.fields,SITUACAO:'AUTORIZADA'};
  const existing={STATUS_IMPORTACAO:'XML_COMPLETO',SITUACAO:'CANCELADA',ULTIMO_NSU:'9223372036854775807',Title:'Prestador',TIPO_FISCAL:'NFS-e',VALOR_TOTAL_NOTA:1000,VALOR_LIQUIDO:921.5,STATUS_DANFE:'DISPONIVEL',DANFE_URL:{Url:'https://example.test/fiscal.pdf',Description:'Fiscal'},XML_URL:{Url:'https://example.test/fiscal.xml',Description:'Original'}};
  const context={items:{Documentos:incoming},outputs:{Existente:existing,Novos_campos:incoming.fields}};
  for(const name of ['SITUACAO','ULTIMO_NSU','Title','TIPO_FISCAL','VALOR_TOTAL_NOTA','VALOR_LIQUIDO','STATUS_DANFE'])assert.equal(evaluate(actions.Campos_finais.inputs[name],context),existing[name],name);
  assert.equal(evaluate(actions.Campos_finais.inputs.DANFE_URL,context).Url,existing.DANFE_URL.Url);
  assert.equal(evaluate(actions.Campos_finais.inputs.XML_URL,context).Url,existing.XML_URL.Url);
  for(const kind of full){const doc=document(kind);assert.match(evaluate(actions.Campos_finais.inputs.XML_URL,{items:{Documentos:doc},outputs:{Existente:{},Novos_campos:doc.fields}}).Url,/\.xml$/);}
  assert.deepEqual(receiver.actions.Ids_confirmados.runAfter,{Documentos:['Succeeded']});
});

test('lote PAD legado usa as mesmas barreiras PDF e lote03 exige CNPJ configurado',()=>{
  const scheduled=fixture.read('02-Sincronizar-NFe.definition.json').actions.Janela_de_coleta.actions.Documentos.actions;
  assert.deepEqual(scheduled.Conferir_identidade,actions.Conferir_identidade);
  assert.deepEqual(scheduled.Conferir_DANFE,actions.Conferir_DANFE);
  assert.deepEqual(receiver.actions.Validar_lote.inputs.schema.required,['source','companyCnpj','documents']);
  assert.deepEqual(receiver.actions.Validar_lote.inputs.schema.properties.companyCnpj.enum,['00000000000000']);
});

test('replay autorizado nao substitui PDF terminal; NFSe realmente terminal marcada ainda pode anexar',()=>{
  const gate=actions.Anexar_DANFE.expression.equals[0];
  for(const kind of full){
    const doc=document(kind);doc.fields.SITUACAO='AUTORIZADA';
    for(const terminal of ['CANCELADA','SUBSTITUIDA']){
      assert.equal(evaluate(gate,{items:{Documentos:doc},outputs:{Nota_gravada:{SITUACAO:terminal}}}),false,kind+' conserva PDF '+terminal);
    }
    assert.equal(evaluate(gate,{items:{Documentos:doc},outputs:{Nota_gravada:{SITUACAO:'AUTORIZADA'}}}),true,kind+' autorizado normal anexa');
    assert.equal(evaluate(gate,{items:{Documentos:doc},outputs:{Nota_gravada:{}}}),true,kind+' registro legado sem estado anexa');
  }
  for(const terminal of ['CANCELADA','SUBSTITUIDA']){
    const doc=document('NFSe');doc.fields.SITUACAO=terminal;
    assert.equal(evaluate(gate,{items:{Documentos:doc},outputs:{Nota_gravada:{SITUACAO:terminal}}}),true,'NFSe com PDF marcado '+terminal+' anexa');
  }
});
