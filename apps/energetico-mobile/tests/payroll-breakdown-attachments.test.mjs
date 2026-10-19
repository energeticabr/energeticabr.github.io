import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createPayrollBreakdownAttachments } from '../src/chat/payroll-breakdown-attachments.js';

const supplier={id:'1',label:'Ana',branch:'OBRA A',profession:'PEDREIRO'};
const file=(text='recibo',name='salario.pdf')=>new File([text],name,{type:'application/pdf'});
function fixture({pending=false,direct=false}={}) {
  const rows={IDFOLHA:{19:{FORNECEDOR:'Ana'}},FOLHAPGTO:{31:{Title:direct?'pago-31':'APP-folha-provisao-12',IDPROVISAO:direct?'':'12',IDFOLHA:'19',FORNECEDOR:'Ana',TIPOPGTO:'SALÁRIO',IDLANCAMENTO:direct?'91':''}},
    'PROVISÃO PGTOS':{12:{IDFOLHA:'19',FORNECEDOR:'Ana',FILIAL:'OBRA A',TIPOPGTO:'SALÁRIO',IDLANCAMENTOS:pending?'':'91',IDPEDIDO:pending?'':'41',DATAPGTOEFETUADO:pending?'':'2026-10-12'}},
    LANCAMENTOS:{91:{FORNECEDOR:'Ana',FILIAL:'OBRA A',IDPGTOAGENDADO:'12',AGRUPAR:'41'}},NOTASPENDENTES:{41:{FORNECEDOR:'Ana',FILIAL:'OBRA A'}}};
  const files=new Map(),writes=[];let lose=false,stop=false;
  const key=(list,id)=>`${list}:${id}`;
  const repo={clearCache(){},resolveList:async(_s,names)=>({id:names[0],status:'resolved'}),
    getColumns:async(_s,list)=>Object.keys(rows[list][Object.keys(rows[list])[0]]).map(name=>({name,displayName:name,text:{}})),
    getItem:async(_s,list,id)=>rows[list]?.[id]?{id:String(id),fields:structuredClone(rows[list][id])}:null,
    listAttachments:async(_s,list,id)=>[...(files.get(key(list,id))||new Map()).keys()].map(name=>({name})),
    downloadAttachment:async(_s,list,id,name)=>files.get(key(list,id)).get(name),
    uploadAttachment:async(_s,list,id,f,name)=>{const dest=files.get(key(list,id))||new Map();files.set(key(list,id),dest);dest.set(name,await f.arrayBuffer());writes.push([list,String(id),name]);if(lose){lose=false;throw new Error('Resposta perdida');}},
  };
  const service=createPayrollBreakdownAttachments({repository:repo,assertSession:()=>{if(stop)throw new Error('Sessão encerrada');}});
  const submit=(uploads=[file()],progress={})=>service.submit({supplier,sheetId:'19',paymentId:'31',files:uploads,progress});
  return{rows,files,writes,repo,service,submit,lose:()=>{lose=true;},stop:()=>{stop=true;}};
}
test('anexo de salário pago chega aos três registros existentes sem escrever valores financeiros',async()=>{
  const f=fixture();const result=await f.submit();
  assert.deepEqual(f.writes.map(w=>w.slice(0,2)),[['PROVISÃO PGTOS','12'],['LANCAMENTOS','91'],['NOTASPENDENTES','41']]);
  assert.equal(result.status,'complete');assert.equal(f.rows.FOLHAPGTO[31].IDFOLHA,'19');
});
test('provisão pendente guarda arquivo para propagação na baixa sem criar lançamento ou pedido',async()=>{
  const f=fixture({pending:true});const result=await f.submit();assert.equal(result.status,'pending-settlement');
  assert.deepEqual(f.writes.map(w=>w[0]),['PROVISÃO PGTOS']);
});
test('origem direta resolve a provisão pelo lançamento e não aceita IDs de destino do chamador',async()=>{
  const f=fixture({direct:true});await f.submit();assert.equal(f.writes.length,3);
});
test('troca de folha, fornecedor, filial ou vínculo reverso é recusada antes de qualquer upload',async()=>{
  for(const mutate of [f=>f.rows.FOLHAPGTO[31].IDFOLHA='20',f=>f.rows['PROVISÃO PGTOS'][12].FORNECEDOR='Beto',f=>f.rows.LANCAMENTOS[91].FILIAL='OUTRA',f=>f.rows.LANCAMENTOS[91].IDPGTOAGENDADO='13',f=>f.rows['PROVISÃO PGTOS'][12].IDPEDIDO='42']){
    const f=fixture();mutate(f);await assert.rejects(f.submit(),/vínculo|fornecedor|filial|folha|pedido/i);assert.equal(f.writes.length,0);
  }
});
test('mesmo nome com bytes diferentes não sobrescreve e preflight evita entrega parcial',async()=>{
  const f=fixture();f.files.set('NOTASPENDENTES:41',new Map([['salario.pdf',await file('outro').arrayBuffer()]]));
  await assert.rejects(f.submit(),/conteúdo diferente/i);assert.equal(f.writes.length,0);
});
test('resposta perdida é recuperada pelo hash e retomada não duplica anexos',async()=>{
  const f=fixture(),progress={};f.lose();await f.submit([file()],progress);await f.submit([file()],JSON.parse(JSON.stringify(progress)));
  assert.equal(f.writes.length,3);assert.ok(progress.manifest[0].sha256.match(/^[a-f0-9]{64}$/));
});
test('arquivo já copiado na baixa com nome diferente é reaproveitado por conteúdo nos três destinos',async()=>{
  const f=fixture();
  for(const target of ['PROVISÃO PGTOS:12','LANCAMENTOS:91','NOTASPENDENTES:41']) f.files.set(target,new Map([['provisao-12-hash-recibo.pdf',await file().arrayBuffer()]]));
  await f.submit();assert.equal(f.writes.length,0);
});
for (const resumed of [false,true]) test(`homônimo conflitante não impede reutilizar bytes idênticos sob outro nome${resumed?' após retomada serializada pendente→pago':''}`,async()=>{
  const f=fixture({pending:resumed}),progress={};
  if(resumed){
    f.repo.uploadAttachment=async()=>{throw new Error('Falha de rede');};
    await assert.rejects(f.submit([file()],progress),/Falha/);
    Object.assign(f.rows['PROVISÃO PGTOS'][12],{DATAPGTOEFETUADO:'2026-10-12',IDLANCAMENTOS:'91',IDPEDIDO:'41'});
    f.rows.FOLHAPGTO[31].IDLANCAMENTO='91';
  }
  const delivered=await file().arrayBuffer(),other=await file('outro filho').arrayBuffer();
  for(const target of ['PROVISÃO PGTOS:12','LANCAMENTOS:91','NOTASPENDENTES:41'])
    f.files.set(target,new Map([['salario.pdf',other],['PROV-12-salario.pdf',delivered]]));
  const service=createPayrollBreakdownAttachments({repository:f.repo});
  const result=await service.submit({supplier,sheetId:'19',paymentId:'31',files:[file()],progress:JSON.parse(JSON.stringify(progress))});
  assert.equal(result.status,'complete');assert.equal(f.writes.length,0);
  for(const inventory of f.files.values()){assert.equal(inventory.size,2);assert.deepEqual(inventory.get('salario.pdf'),other);}
});
test('manifesto preservado exige os mesmos bytes após reiniciar sem recriar registros',async()=>{
  const f=fixture(),progress={};await f.submit([file()],progress);
  await assert.rejects(f.submit([],progress),/selecione novamente/i);
  await assert.rejects(f.submit([file('outro')],progress),/mesmos arquivos/i);assert.equal(f.writes.length,3);
});
test('baixa durante falha de anexo permite retomar somente a expansão dos vínculos da mesma provisão',async()=>{
  const f=fixture({pending:true}),upload=f.repo.uploadAttachment,progress={};
  f.repo.uploadAttachment=async()=>{throw new Error('Falha de rede');};await assert.rejects(f.submit([file()],progress),/Falha/);
  Object.assign(f.rows['PROVISÃO PGTOS'][12],{DATAPGTOEFETUADO:'2026-10-12',IDLANCAMENTOS:'91',IDPEDIDO:'41'});f.repo.uploadAttachment=upload;
  await f.submit([file()],JSON.parse(JSON.stringify(progress)));assert.equal(f.writes.length,3);
});
test('vínculo alterado entre destinos interrompe sem enviar a outro registro',async()=>{
  const f=fixture(),upload=f.repo.uploadAttachment;
  f.repo.uploadAttachment=async(...args)=>{await upload(...args);f.rows.LANCAMENTOS[91].AGRUPAR='42';};
  await assert.rejects(f.submit(),/vínculo|pedido/i);assert.equal(f.writes.length,1);
});
test('sem provisão preexistente entrega apenas aos vínculos válidos e informa ausência',async()=>{
  const f=fixture({direct:true});f.rows.LANCAMENTOS[91].IDPGTOAGENDADO='';
  const result=await f.submit();assert.equal(result.status,'missing-provision');assert.equal(f.writes.length,2);
});
test('arquivo inválido e sessão encerrada impedem todos os uploads',async()=>{
  const f=fixture();await assert.rejects(f.submit([file('texto','programa.exe')]),/tipo/i);f.stop();await assert.rejects(f.submit(),/Sessão/);assert.equal(f.writes.length,0);
});
