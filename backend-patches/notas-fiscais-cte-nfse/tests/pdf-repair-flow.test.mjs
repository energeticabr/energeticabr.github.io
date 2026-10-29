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
  assert.equal(d.triggers.manual.kind,'Button');assert.equal(d.triggers.manual.runtimeConfiguration.concurrency.runs,1);
  assert.equal(p.Atualizar_PDF.inputs.host.operationId,'UpdateFile');
  assert.equal(p.Atualizar_PDF.runAfter.Metadados_anexo[0],'Succeeded');
  assert.equal(p.Metadados_anexo.runAfter.Localizar_anexo[0],'Succeeded');
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
  const note={Id:1,STATUS_IMPORTACAO:'XML_COMPLETO',SITUACAO:'CANCELADA',TIPO_FISCAL:'NFS-e',XML_URL:{Url:`https://example.sharepoint.com${f.config.libraryPath}/${key}-000000000000001-${sha.slice(0,16)}.xml`},DANFE_URL:{Url:`https://example.sharepoint.com/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ/Attachments/1/${doc.danfe.fileName}`}};
  assert.deepEqual(evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:{...doc,expectedSituation:'CANCELADA'}},outputs:{Nota:note}}),{valid:true});
  assert.deepEqual(evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:{...doc,expectedSituation:'AUTORIZADA'}},outputs:{Nota:note}}),{});
  assert.deepEqual(evaluate(p.Conferir_estado.inputs.content,{items:{Documentos:{...doc,expectedSituation:'CANCELADA'}},outputs:{Nota:{...note,XML_URL:{Url:'https://outside.example/other.xml'}}}}),{});
 }finally{f.cleanup();}
});
