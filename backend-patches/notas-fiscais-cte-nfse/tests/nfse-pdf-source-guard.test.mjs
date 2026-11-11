import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluate} from './wdl.mjs';

test('definicoes publicaveis recusam espelho NFSe legado nos mesmos gates dos builders',()=>{
  const read=name=>JSON.parse(fs.readFileSync(new URL('../powerautomate/'+name,import.meta.url),'utf8'));
  const scheduled=read('02-Sincronizar-NFe.definition.json').actions.Janela_de_coleta.actions.Documentos.actions;
  const receiver=read('03-Receber-NFe.definition.json').actions.Documentos.actions;
  const repair=read('07-Corrigir-Espelhos-PDF.definition.json').actions.Documentos.actions;
  const key='1'.repeat(50),sha='a'.repeat(64);
  const doc={kind:'NFSe',key,sha256:sha,xmlSha256:sha,danfe:{fileName:`DANFSe-${key}-${sha.slice(0,16)}.pdf`,sha256:'b'.repeat(64),source:'LOCAL_DANFSE_NACIONAL'}};
  const gates=[
    [scheduled.Conferir_DANFE.actions.Conferir_identidade_pdf.inputs.content,'valido'],
    [receiver.Conferir_DANFE.actions.Conferir_identidade_pdf.inputs.content,'valido'],
    [repair.Conferir_identidade.inputs.content,'valid'],
  ];
  for(const [gate,label] of gates){
    assert.deepEqual(evaluate(gate,{items:{Documentos:doc}}),{[label]:true});
    const legacy=structuredClone(doc);delete legacy.danfe.source;
    assert.deepEqual(evaluate(gate,{items:{Documentos:legacy}}),{});
  }
});
