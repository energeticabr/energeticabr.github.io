import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createFlowFixture} from './flow-fixture.mjs';
import {evaluate} from './wdl.mjs';
test('PDF repair only replaces its existing attachment after XML/status identity; never edits fiscal fields or messages',()=>{
 const f=createFlowFixture('pdf-repair');
 try{
  fs.copyFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/build-pdf-repair-flow.mjs'),path.join(f.root,'scripts/build-pdf-repair-flow.mjs'));
  execFileSync(process.execPath,[path.join(f.root,'scripts/build-pdf-repair-flow.mjs')],{cwd:path.dirname(f.root)});
  const d=f.read('07-Corrigir-Espelhos-PDF.definition.json'),p=d.actions.Documentos.actions;
  const input=d.triggers.manual.inputs.schema;
  assert.deepEqual(input.properties.source.enum,['FISCAL_PDF_LAYOUT_REPAIR']);
  assert.deepEqual(input.properties.companyCnpj.enum,[f.config.companyCnpj]);
  assert.equal(input.properties.documents.items.properties.key.minLength,44);
  assert.equal(input.properties.documents.items.properties.key.maxLength,50);
  assert.equal(d.triggers.manual.kind,'Button');assert.equal(d.triggers.manual.runtimeConfiguration.concurrency.runs,1);
  assert.equal(p.Atualizar_PDF.inputs.host.operationId,'UpdateFile');
  assert.equal(p.Atualizar_PDF.runAfter.Metadados_anexo[0],'Succeeded');
  assert.equal(p.Metadados_anexo.runAfter.Conferir_anexo[0],'Succeeded');
  assert.equal(p.Localizar_anexo.runAfter.Conferir_XML[0],'Succeeded');
  assert.equal(p.Conferir_XML.runAfter.Baixar_XML[0],'Succeeded');
  assert.equal(p.Conferir_PDF.runAfter.Baixar_PDF[0],'Succeeded');
  assert.equal(p.Conferir_estado_final.runAfter.Nota_depois[0],'Succeeded');
  assert.ok(!/CreateAttachment|CreateFile|MERGE|PatchItem|CreateItem|whatsapp|gateway_outbox/i.test(JSON.stringify(d)));
  const key='1'.repeat(50),sha='a'.repeat(64),doc={key,xmlSha256:sha,danfe:{fileName:`DANFSe-${key}-${sha.slice(0,16)}.pdf`,sha256:'b'.repeat(64)}};
  assert.deepEqual(evaluate(p.Conferir_identidade.inputs.content,{items:{Documentos:doc}}),{valid:true});
  assert.deepEqual(evaluate(p.Conferir_identidade.inputs.content,{items:{Documentos:{...doc,key:"'"+'1'.repeat(49)}}}),{});
  assert.deepEqual(evaluate(p.Conferir_XML.inputs.content,{items:{Documentos:{xmlBase64:'abc'}},body:{Baixar_XML:{$content:'abc'}}}),{valid:true});
  assert.deepEqual(evaluate(p.Conferir_XML.inputs.content,{items:{Documentos:{xmlBase64:'abc'}},body:{Baixar_XML:{$content:'def'}}}),{});
  const note={Id:1,CHAVE_ACESSO:key,STATUS_IMPORTACAO:'XML_COMPLETO',SITUACAO:'CANCELADA',TIPO_FISCAL:'NFS-e',XML_URL:{Url:`https://example.sharepoint.com${f.config.libraryPath}/${key}-000000000000001-${sha.slice(0,16)}.xml`},DANFE_URL:{Url:`https://example.sharepoint.com/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ/Attachments/1/${doc.danfe.fileName}`}};
  assert.deepEqual(evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:{...doc,expectedSituation:'CANCELADA'}},outputs:{Nota:note}}),{valid:true});
  assert.deepEqual(evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:{...doc,expectedSituation:'AUTORIZADA'}},outputs:{Nota:note}}),{});
  assert.deepEqual(evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:{...doc,expectedSituation:'CANCELADA'}},outputs:{Nota:{...note,XML_URL:{Url:'https://outside.example/other.xml'}}}}),{});
  const cteKey='31261012345678000123570010000001231000001234';
  const cteDoc={...doc,key:cteKey,expectedSituation:'AUTORIZADA',danfe:{...doc.danfe,fileName:`DACTE-${cteKey}-${sha.slice(0,16)}.pdf`}};
  const cteNote={...note,CHAVE_ACESSO:cteKey,SITUACAO:'AUTORIZADA',TIPO_FISCAL:'CT-e',MODELO:'57',TIPO_DOCUMENTO:'cteProc',XML_URL:{Url:`https://example.sharepoint.com${f.config.libraryPath}/${cteKey}-000000000000002-${sha.slice(0,16)}.xml`},DANFE_URL:{Url:`https://example.sharepoint.com/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ/Attachments/1/${cteDoc.danfe.fileName}`}};
  const identity=value=>evaluate(p.Conferir_identidade.inputs.content,{items:{Documentos:value}});
  const state=(value,row)=>evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:value},outputs:{Nota:row}});
  assert.deepEqual(identity(cteDoc),{valid:true});
  assert.deepEqual(state(cteDoc,cteNote),{valid:true});
  for(const value of [
   {...cteDoc,key:cteKey.slice(0,-1)}, {...cteDoc,key:cteKey+'0'},
   {...cteDoc,key:cteKey.replace('57','67')}, {...cteDoc,key:'A'+cteKey.slice(1)},
   {...cteDoc,danfe:{...cteDoc.danfe,fileName:cteDoc.danfe.fileName.replace('DACTE-','DANFSe-')}},
   {...doc,danfe:{...doc.danfe,fileName:doc.danfe.fileName.replace('DANFSe-','DACTE-')}},
   {...cteDoc,xmlSha256:'c'.repeat(64)}, {...cteDoc,xmlSha256:'A'.repeat(64)},
   {...cteDoc,danfe:{...cteDoc.danfe,sha256:'NOT_A_SHA256'}},
   {...cteDoc,fiscalType:'NFS-e'}, {...doc,fiscalType:'CT-e'},
  ])assert.deepEqual(identity(value),{});
  assert.deepEqual(identity({...cteDoc,fiscalType:'CT-e'}),{valid:true});
  assert.deepEqual(identity({...doc,fiscalType:'NFS-e'}),{valid:true});
  for(const row of [
   {...cteNote,TIPO_FISCAL:'NFS-e'}, {...cteNote,MODELO:'67'}, {...cteNote,TIPO_DOCUMENTO:'cteSimpProc'},
   {...cteNote,SITUACAO:'CANCELADA'}, {...cteNote,CHAVE_ACESSO:key},
   {...cteNote,DANFE_URL:{Url:cteNote.DANFE_URL.Url.replace('/Attachments/1/','/Attachments/2/')}},
   {...cteNote,DANFE_URL:{Url:cteNote.DANFE_URL.Url.replace('example.sharepoint.com','outside.example')}},
   {...cteNote,XML_URL:{Url:cteNote.XML_URL.Url.replace(cteKey,key)}},
  ])assert.deepEqual(state(cteDoc,row),{});
  assert.equal(p.Conferir_anexo.runAfter.Localizar_anexo[0],'Succeeded');
  assert.equal(p.Metadados_anexo.runAfter.Conferir_anexo[0],'Succeeded');
  const existing={FileName:cteDoc.danfe.fileName,ServerRelativeUrl:`/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ/Attachments/1/${cteDoc.danfe.fileName}`};
  const attachment=value=>evaluate(p.Conferir_anexo.inputs.content,{items:{Documentos:cteDoc},outputs:{Nota:cteNote},body:{Localizar_anexo:{d:value}}});
  assert.deepEqual(attachment(existing),{valid:true});
  assert.deepEqual(attachment({...existing,FileName:'other.pdf'}),{});
  assert.deepEqual(attachment({...existing,ServerRelativeUrl:existing.ServerRelativeUrl.replace('/Attachments/1/','/Attachments/2/')}),{});
  const finalState=row=>evaluate(p.Conferir_estado_final.inputs.content,{items:{Documentos:cteDoc},outputs:{Nota:cteNote},body:{Nota_depois:{d:row}}});
  assert.deepEqual(finalState(cteNote),{valid:true});
  for(const row of [{...cteNote,SITUACAO:'CANCELADA'}, {...cteNote,TIPO_FISCAL:'NFS-e'},
   {...cteNote,MODELO:'67'}, {...cteNote,TIPO_DOCUMENTO:'cteSimpProc'},
   {...cteNote,XML_URL:{Url:cteNote.XML_URL.Url+'changed'}},
   {...cteNote,DANFE_URL:{Url:cteNote.DANFE_URL.Url+'changed'}}])assert.deepEqual(finalState(row),{});
 }finally{f.cleanup();}
});
