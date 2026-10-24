import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMealVoucherSchema } from '../src/chat/meal-voucher-schema.js';

const valid = () => ({ name:'VALECONTROLE', displayName:'VALECONTROLE', hidden:true, required:false, readOnly:false,
  text:{ allowMultipleLines:true, appendChangesToExistingText:false, textType:'plain' } });
function setup({ columns = [], lost = false, denied = false } = {}) {
  let reads = 0, cleared = 0; const posts = [];
  const repository = {
    resolveList:async (site, names) => { assert.equal(site,'personal'); assert.deepEqual(names,['NOTASPENDENTES']); return {status:'resolved',id:'orders'}; },
    getColumns:async (_site,_id,options) => { assert.equal(options.includeHidden,true); reads++; return columns; },
    resolveSites:async () => ({personal:{id:'site-id'}}), clearCache:() => {cleared++;},
  };
  const graph = { request:async (path,options) => { posts.push({path,options}); if (denied) throw new Error('sem permissão de administrar lista'); columns = [valid()]; if (lost) throw new Error('resposta perdida'); } };
  return {repository,graph,posts,get reads(){return reads;},get cleared(){return cleared;}};
}
test('schema do vale cria somente a coluna técnica oculta e confirma após invalidar cache', async () => {
  const f = setup(); await ensureMealVoucherSchema(f);
  assert.equal(f.posts.length,1); assert.equal(f.posts[0].path,'/sites/site-id/lists/orders/columns');
  assert.equal(f.posts[0].options.body.name,'VALECONTROLE'); assert.equal(f.posts[0].options.body.hidden,true);
  assert.equal(f.posts[0].options.body.text.allowMultipleLines,true); assert.equal(f.posts[0].options.body.text.appendChangesToExistingText,false);
  assert.deepEqual(f.posts[0].options.scopes,['Sites.Manage.All']); assert.equal(f.cleared,1); assert.equal(f.reads,2);
});
test('schema do vale não pede administração quando a coluna já foi provisionada', async () => {
  const f = setup({columns:[valid()]}); await ensureMealVoucherSchema(f); assert.equal(f.posts.length,0);
});
test('resposta perdida na criação de schema só é aceita após releitura da coluna correta', async () => {
  const f = setup({lost:true}); await ensureMealVoucherSchema(f); assert.equal(f.posts.length,1); assert.equal(f.reads,2);
});
for (const change of [c=>{c.hidden=false;},c=>{c.readOnly=true;},c=>{c.required=true;},c=>{c.text.allowMultipleLines=false;},c=>{c.text.appendChangesToExistingText=true;},c=>{c.text.textType='richText';}]) {
  test(`schema do vale recusa coluna incompatível: ${change}`, async () => {
    const c = valid(); change(c); const f = setup({columns:[c]}); await assert.rejects(ensureMealVoucherSchema(f),/VALECONTROLE/); assert.equal(f.posts.length,0);
  });
}
test('falta de permissão não é confundida com migração concluída', async () => {
  const f = setup({denied:true}); await assert.rejects(ensureMealVoucherSchema(f),/permissão/); assert.equal(f.reads,2);
});
