import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFlowFixture} from './flow-fixture.mjs';

const fixture=createFlowFixture('retention-provision');after(()=>fixture.cleanup());fixture.build();
const {evaluate}=await import(pathToFileURL(path.join(fixture.root,'tests/wdl.mjs')));
const receiver=fixture.read('03-Receber-NFe.definition.json');
const scheduled=fixture.read('02-Sincronizar-NFe.definition.json');
const actions=receiver.actions.Documentos.actions;
const provision=actions.Garantir_provisao_retencao;

const fields=(changes={})=>({CHAVE_ACESSO:'31261012345678000123550010000001231000001234',Title:'FORNECEDOR TESTE SA',
  TIPO_FISCAL:'NF-e',STATUS_RETENCOES:'RETENCAO_INFORMADA_XML',STATUS_IMPORTACAO:'XML_COMPLETO',
  DIRECAO:'ENTRADA',SITUACAO:'AUTORIZADA',DATA_EMISSAO:'2026-10-31T23:50:00-03:00',...changes});
const context=value=>({outputs:{Campos_finais:value,Total_retido_comprador:evaluate(actions.Total_retido_comprador.inputs,{outputs:{Campos_finais:value}})}});

test('calcula apenas componentes retidos pelo comprador sem duplicar TOTAL_RETIDO da NFS-e',()=>{
  const nfe=fields({PIS_RETIDO:1.82,COFINS_RETIDA:8.40,CSLL_RETIDA:13.02,IRRF_RETIDO:5,INSS_RETIDO:10,ISS_RETIDO:2.10});
  assert.ok(Math.abs(evaluate(actions.Total_retido_comprador.inputs,{outputs:{Campos_finais:nfe}})-40.34)<1e-9);
  const nfse=fields({TIPO_FISCAL:'NFS-e',CONTRIB_SOCIAIS_RETIDAS:13.02,IRRF_RETIDO:2.5,INSS_RETIDO:1,ISS_RETIDO:0,TOTAL_RETIDO:999999});
  assert.ok(Math.abs(evaluate(actions.Total_retido_comprador.inputs,{outputs:{Campos_finais:nfse}})-16.52)<1e-9);
  assert.equal(evaluate(actions.Total_retido_comprador.inputs,{outputs:{Campos_finais:fields({TIPO_FISCAL:'CT-e'})}}),0);
});

test('provisiona somente documento completo autorizado de entrada com retencao positiva',()=>{
  const eligible=fields({PIS_RETIDO:1});
  assert.equal(evaluate(provision.expression,context(eligible)),true);
  for(const change of [{DIRECAO:'SAIDA'},{SITUACAO:'CANCELADA'},{SITUACAO:'SUBSTITUIDA'},{STATUS_IMPORTACAO:'EVENTO_SEM_XML'},
    {STATUS_RETENCOES:'NAO_INFORMADA_XML'},{TIPO_FISCAL:'CT-e'},{PIS_RETIDO:0}]){
    const value=fields({...change,PIS_RETIDO:change.PIS_RETIDO??1});
    assert.equal(evaluate(provision.expression,context(value)),false,JSON.stringify(change));
  }
});

test('vencimento e rubrica usam dia20 do mes seguinte inclusive virada do ano',()=>{
  const inside=provision.actions;
  for(const [issued,due,key] of [['2026-10-31T23:50:00-03:00','2026-11-20T00:00:00-03:00','RETENCAO-2026-11'],
    ['2026-12-05T09:00:00-03:00','2027-01-20T00:00:00-03:00','RETENCAO-2027-01']]){
    const outputs={Campos_finais:fields({DATA_EMISSAO:issued})};
    outputs.Vencimento_retencao=evaluate(inside.Vencimento_retencao.inputs,{outputs});
    assert.equal(outputs.Vencimento_retencao,due);
    assert.equal(evaluate(inside.Chave_rubrica_retencao.inputs,{outputs}),key);
  }
});

test('pai mensal e filho por nota usam chaves unicas e recusam resultados ambiguos',()=>{
  const inside=provision.actions;
  assert.match(inside.Localizar_rubrica_retencao.inputs.parameters['parameters/uri'],/FOLHAOPERACAO/);
  assert.match(inside.Localizar_provisao_retencao.inputs.parameters['parameters/uri'],/FOLHAOPERACAO/);
  assert.deepEqual(inside.Conferir_rubrica_unica.inputs.schema.enum,[0,1]);
  assert.deepEqual(inside.Conferir_provisao_unica.inputs.schema.enum,[0,1]);
  const shared={Campos_finais:fields({PIS_RETIDO:1}),Vencimento_retencao:'2026-11-20T00:00:00-03:00',Chave_rubrica_retencao:'RETENCAO-2026-11',
    Prefixo_filhos_retencao:'RETENCAO-2026-11-NOTA-',Chave_provisao_retencao:'RETENCAO-NOTA-'+fields().CHAVE_ACESSO,Rubrica_retencao:42,Total_retido_comprador:1};
  const parent=JSON.parse(evaluate(inside.Garantir_rubrica_retencao.actions.Criar_rubrica_retencao.inputs.parameters['parameters/body'],{outputs:shared}));
  assert.deepEqual(Object.keys(parent).sort(),['DATAPREVISTOPGTO','FILIAL','FOLHAOPERACAO','STATUS','Title','VALORTOTAL'].sort());
  assert.equal(parent.STATUS,'PAGAMENTO PREVISTO');
  assert.equal(parent.FILIAL,'004 - EDIFÍCIO XAVANTE');
  const child=JSON.parse(evaluate(inside.Criar_se_ausente_provisao_retencao.actions.Criar_provisao_retencao.inputs.parameters['parameters/body'],{outputs:shared}));
  assert.deepEqual(Object.keys(child).sort(),['DATAPREVISTOPGTO','DESCRITIVOPROVISAO','FILIAL','FOLHAOPERACAO','OBS','QTD','STATUS','Title','VALORTOTAL'].sort());
  assert.equal(child.STATUS,'PAGAMENTO PREVISTO');
  assert.equal(child.FILIAL,'004 - EDIFÍCIO XAVANTE');
  assert.equal(child.QTD,'1');
});

test('observacao identifica fornecedor emissao e produto ou servico da nota retida',()=>{
  const inside=provision.actions;
  const base={Vencimento_retencao:'2026-11-20T00:00:00-03:00',Chave_rubrica_retencao:'RETENCAO-2026-11',
    Prefixo_filhos_retencao:'RETENCAO-2026-11-NOTA-',Chave_provisao_retencao:'RETENCAO-NOTA-'+fields().CHAVE_ACESSO,Rubrica_retencao:42,Total_retido_comprador:10};
  const create=inside.Criar_se_ausente_provisao_retencao.actions.Criar_provisao_retencao.inputs.parameters['parameters/body'];
  const nfeFields=fields({Title:'JM ESCORAMENTOS LTDA',DATA_EMISSAO:'2026-10-31T14:25:00-03:00'});
  const nfe=JSON.parse(evaluate(create,{outputs:{...base,Campos_finais:nfeFields},items:{Documentos:{fields:{DESCRICAO_ITENS:'ESCORAMENTO METALICO; LOCACAO DE ANDAIME'}}}}));
  assert.equal(nfe.OBS,'RAZÃO SOCIAL: JM ESCORAMENTOS LTDA | EMISSÃO: 31/10/2026 14:25 | PRODUTO/SERVIÇO: ESCORAMENTO METALICO; LOCACAO DE ANDAIME');
  const nfseFields=fields({TIPO_FISCAL:'NFS-e',Title:'PRESTADORA TESTE LTDA',DATA_EMISSAO:'2026-10-30T09:08:00-03:00',DESCRICAO_SERVICO:'SERVICO DE ENGENHARIA'});
  const nfse=JSON.parse(evaluate(create,{outputs:{...base,Campos_finais:nfseFields},items:{Documentos:{fields:nfseFields}}}));
  assert.equal(nfse.OBS,'RAZÃO SOCIAL: PRESTADORA TESTE LTDA | EMISSÃO: 30/10/2026 09:08 | PRODUTO/SERVIÇO: SERVICO DE ENGENHARIA');
});

test('observacao usa traco para detalhe fiscal ausente sem impedir a provisao',()=>{
  const inside=provision.actions;
  const value=fields({Title:null,DATA_EMISSAO:null});
  const outputs={Campos_finais:value,Vencimento_retencao:'2026-11-20T00:00:00-03:00',Chave_rubrica_retencao:'RETENCAO-2026-11',
    Prefixo_filhos_retencao:'RETENCAO-2026-11-NOTA-',Chave_provisao_retencao:'RETENCAO-NOTA-'+fields().CHAVE_ACESSO,Rubrica_retencao:42,Total_retido_comprador:10};
  const create=inside.Criar_se_ausente_provisao_retencao.actions.Criar_provisao_retencao.inputs.parameters['parameters/body'];
  const child=JSON.parse(evaluate(create,{outputs,items:{Documentos:{fields:{}}}}));
  assert.equal(child.OBS,'RAZÃO SOCIAL: - | EMISSÃO: - | PRODUTO/SERVIÇO: -');
});

test('grava valores de retencao com virgula e soma registros novos e legados sem alterar o valor',()=>{
  const inside=provision.actions;
  const shared={Campos_finais:fields({PIS_RETIDO:1347.58}),Vencimento_retencao:'2026-11-20T00:00:00-03:00',Chave_rubrica_retencao:'RETENCAO-2026-11',
    Prefixo_filhos_retencao:'RETENCAO-2026-11-NOTA-',Chave_provisao_retencao:'RETENCAO-NOTA-'+fields().CHAVE_ACESSO,Rubrica_retencao:42,Total_retido_comprador:1347.58};
  const parent=JSON.parse(evaluate(inside.Garantir_rubrica_retencao.actions.Criar_rubrica_retencao.inputs.parameters['parameters/body'],{outputs:shared}));
  const child=JSON.parse(evaluate(inside.Criar_se_ausente_provisao_retencao.actions.Criar_provisao_retencao.inputs.parameters['parameters/body'],{outputs:shared}));
  const total=JSON.parse(evaluate(inside.Atualizar_total_rubrica.inputs.parameters['parameters/body'],{variables:{RetentionParentTotal:4220.6}}));
  assert.equal(parent.VALORTOTAL,'0,00');
  assert.equal(child.VALORTOTAL,'1347,58');
  assert.equal(total.VALORTOTAL,'4220,60');
  const accumulate=inside.Somar_provisoes_rubrica.actions.Acumular_total_rubrica.inputs.value;
  assert.equal(evaluate(accumulate,{items:{Somar_provisoes_rubrica:{VALORTOTAL:'1347,58'}}}),1347.58);
  assert.equal(evaluate(accumulate,{items:{Somar_provisoes_rubrica:{VALORTOTAL:'13.02'}}}),13.02);
});

test('recalcula total do pai depois de garantir o filho e usa consulta mensal indexada',()=>{
  const inside=provision.actions;
  assert.deepEqual(inside.Zerar_total_rubrica.runAfter,{Criar_se_ausente_provisao_retencao:['Succeeded']});
  assert.match(inside.Listar_provisoes_rubrica.inputs.parameters['parameters/uri'],/startswith\(Title/);
  assert.deepEqual(inside.Somar_provisoes_rubrica.runAfter,{Listar_provisoes_rubrica:['Succeeded']});
  assert.equal(inside.Somar_provisoes_rubrica.actions.Acumular_total_rubrica.type,'IncrementVariable');
  assert.deepEqual(inside.Atualizar_total_rubrica.runAfter,{Somar_provisoes_rubrica:['Succeeded']});
  assert.equal(inside.Atualizar_total_rubrica.inputs.parameters['parameters/headers']['X-HTTP-Method'],'MERGE');
});

test('variavel e barreira de provisao existem nos fluxos agendado e manual',()=>{
  assert.equal(receiver.actions.Inicializar_total_retencoes.inputs.variables[0].type,'Float');
  assert.deepEqual(receiver.actions.Documentos.runAfter,{Inicializar_total_retencoes:['Succeeded']});
  assert.deepEqual(actions.Confirmar_id_criado.runAfter,{Garantir_provisao_retencao:['Succeeded']});
  assert.equal(scheduled.actions.Inicializar_total_retencoes.inputs.variables[0].name,'RetentionParentTotal');
  assert.deepEqual(scheduled.actions.Janela_de_coleta.runAfter,{Inicializar_total_retencoes:['Succeeded']});
  assert.ok(scheduled.actions.Janela_de_coleta.actions.Documentos.actions.Garantir_provisao_retencao);
});
