import assert from 'node:assert/strict';
import test from 'node:test';
import { createNfeLearningExample, createNfeLearningModel, nfeLearningIssuerHash } from '../src/chat/nfe-proposal-learning.js';

const invoice = { taxId:'12.345.678/0001-90', supplier:'Distribuidora Fictícia', key:'1'.repeat(44) };
const catalog = {
  suppliers:[{id:'10'}, {id:'11'}],
  branches:[{id:'20', label:'Obra Centro'}, {id:'21', label:'Obra Norte'}],
  accounts:[{id:'30'}, {id:'31'}],
  products:[{id:'40'}, {id:'41'}, {id:'42'}],
  stages:[{id:'50', branch:'Obra Centro'}, {id:'51', branch:'Obra Centro'}, {id:'52', branch:'Obra Norte'}],
};
const line = { number:'1', code:'ABC-123', description:'Cabo flexível cobre isolamento 750V azul', unit:'M', quantity:'17.10', unitPrice:'23.45' };
const fiscal = { lines:[line] };
const baseLine = { number:'1', productId:'40', stageId:'50', quantity:'17.10', unitPrice:'23.45', discount:'0', adjustment:'0', date:'2026-11-01', dueDate:'' };
const baseline = { supplierId:'10', branchId:'20', accountId:'30', lines:[baseLine] };
const reviewed = { ...baseline, lines:[{ ...baseLine, productId:'41', stageId:'51' }] };

function example(after = reviewed, before = baseline, source = fiscal, issuer = invoice) {
  return createNfeLearningExample(issuer, source, before, after);
}

function model(examples, issuer = invoice, source = fiscal, options = catalog) {
  return createNfeLearningModel(examples, issuer, source, options);
}

test('one example learns a known correction and serializes no raw issuer, financial amounts, dates or access key', () => {
  const event = example({ ...reviewed, lines:[{ ...reviewed.lines[0], quantity:'2.5', dueDate:'2026-12-23' }] });
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /Distribuidora|12[.]345|12345678000190|1{44}|17\.10|23\.45|2026-12-23/);
  assert.equal(event.lines.length, 1);
  assert.deepEqual(new Set(event.lines[0].changed), new Set(['productId','stageId','quantity','dueDate']));
  const trained = model([JSON.parse(serialized)]);
  assert.equal(trained.product(line), '41');
  assert.equal(trained.stage(line, '20', '41'), '51');
  assert.equal(trained.stage(line, '21', '41'), '');
  assert.equal(trained.stage(line, '20', '40'), '');
});

test('a blank proposal filled at review can be learned even when its description is absent from the original catalog', () => {
  const unknown = { ...line, description:'Conjunto reservado para selagem industrial QF17' };
  const source = { lines:[unknown] };
  const unfilled = { ...baseline, lines:[{ ...baseLine, productId:'', stageId:'' }] };
  const event = example(reviewed, unfilled, source);
  const result = model([event], invoice, source);
  assert.equal(result.product(unknown), '41');
  assert.equal(result.stage(unknown,'20','41'), '51');
  assert.equal(result.product({ ...unknown, code:'' }), '41');
  assert.equal(result.product({ ...unknown, code:'OTHER-PRODUCT' }), '');
});

test('same issuer and distinctive fiscal wording may match while different issuer, measure or code reuse does not', () => {
  const event = example();
  const result = model([event], { ...invoice, taxId:'12345678000190', supplier:'ALTERAÇÃO DE RAZÃO SOCIAL' });
  assert.equal(result.product({ ...line, description:'Cabo flexível cobre isolamento 750V azul premium' }), '41');
  assert.equal(result.product({ ...line, description:'Cabo flexível cobre isolamento 450V azul' }), '');
  assert.equal(result.product({ ...line, description:'Tinta de parede branca' }), '');
  assert.equal(result.product({ ...line, unit:'CX' }), '');
  assert.equal(model([event], { ...invoice, taxId:'23.456.789/0001-90' }).product(line), '');
  const nameless = example(reviewed, baseline, fiscal, { supplier:'Serviços Fictícios Ltda.' });
  assert.equal(model([nameless], { supplier:'Servicos Ficticios Ltda' }).product(line), '41');
  assert.equal(model([nameless], { supplier:'Servicos Ficticios Ltda ME' }).product(line), '');
});

test('ignores ambiguous suggestions from the same event and prefers the newest exact explicit correction across events', () => {
  const conflictingFiscal = { lines:[line, {...line, number:'2'}] };
  const before = { ...baseline, lines:[baseLine,{ ...baseLine, number:'2' }] };
  const after = { ...reviewed, lines:[reviewed.lines[0],{ ...reviewed.lines[0], number:'2', productId:'42' }] };
  assert.equal(model([example(after,before,conflictingFiscal)]).product(line), '');
  const older = example({ ...reviewed, lines:[{ ...reviewed.lines[0], productId:'42' }] });
  assert.equal(model([example(),older]).product(line), '41');
  assert.equal(model([example(),older]).product({ ...line, description:line.description+' premium' }), '');
});

test('does not propose removed catalog entries or a stage now assigned to another branch', () => {
  const after = { ...reviewed, supplierId:'11', branchId:'21', accountId:'31', lines:[{...reviewed.lines[0],stageId:'52'}] };
  const event = example(after);
  assert.deepEqual(model([event]).header, { supplierId:'11', branchId:'21', accountId:'31' });
  const removed = { ...catalog, suppliers:[], products:catalog.products.filter(product => product.id !== '41'), accounts:[] };
  assert.equal(model([event], invoice, fiscal, removed).product(line), '');
  assert.deepEqual(model([event], invoice, fiscal, removed).header, {});
  const stageMoved = { ...catalog, stages:catalog.stages.map(stage => ({ ...stage, branch:'Obra Centro' })) };
  assert.equal(model([event], invoice, fiscal, stageMoved).stage(line,'21','41'), '');
});

test('recalls one complete header from the most recent corrected proposal and never combines different suppliers', () => {
  const older = example({ ...reviewed, supplierId:'11' });
  const newest = example({ ...reviewed, branchId:'21', accountId:'31' });
  assert.deepEqual(newest.headerChanged, ['branchId','accountId']);
  assert.deepEqual(model([newest, older]).header, { supplierId:'10', branchId:'21', accountId:'31' });
  const staleNewest = { ...catalog, branches:catalog.branches.filter(branch => branch.id !== '21') };
  assert.deepEqual(model([newest, older], invoice, fiscal, staleNewest).header, {});
});

test('numeric spelling is immaterial while a real financial edit captures decisions without reusing amounts', () => {
  const equal = { ...baseline, lines:[{...baseLine, quantity:'17,1000', unitPrice:23.45, discount:'0.00', adjustment:'-0'}] };
  assert.equal(example(equal), null);
  const edited = { ...baseline, lines:[{ ...baseLine, quantity:'20.1', date:'2026-11-02' }] };
  const event = example(edited);
  assert.deepEqual(new Set(event.lines[0].changed), new Set(['quantity','date']));
  assert.equal(model([event]).product(line), '40');
  assert.equal(model([event]).stage(line,'20','40'), '50');
  assert.doesNotMatch(JSON.stringify(event), /20\.1|2026-11-02/);
  assert.equal(model([event,example()]).product(line), '41');
});

test('records recalculated stages as context and learns direct stage selections as corrections', () => {
  const automatic = createNfeLearningExample(invoice, fiscal, baseline, reviewed, new Set());
  assert.deepEqual(automatic.lines[0].changed, ['productId']);
  assert.equal(automatic.lines[0].stageId, '51');
  const explicit = createNfeLearningExample(invoice, fiscal, baseline, reviewed, new Set(['1']));
  assert.deepEqual(explicit.lines[0].changed, ['productId','stageId']);
});

test('precomputed cryptographic issuer hashes scope both capture and recall and are never confused with a raw issuer', async () => {
  const learningIssuerHash = await nfeLearningIssuerHash(invoice);
  assert.match(learningIssuerHash, /^[a-f0-9]{64}$/);
  assert.equal(await nfeLearningIssuerHash({ ...invoice, taxId:'12345678000190' }), learningIssuerHash);
  const issuer = { ...invoice, learningIssuerHash };
  const event = example(reviewed,baseline,fiscal,issuer);
  assert.equal(event.issuer, learningIssuerHash);
  assert.equal(model([event],issuer).product(line), '41');
  assert.equal(model([event],{...invoice, learningIssuerHash:'f'.repeat(64)}).product(line), '');
});
