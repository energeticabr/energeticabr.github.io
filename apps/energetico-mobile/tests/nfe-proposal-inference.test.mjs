import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNfeProposal } from '../src/chat/nfe-proposal-model.js';
import { materializeNfeProposal, materializeNfeProvision } from '../src/chat/nfe-proposal-data.js';

const product = (id, label, unit = 'SACO') => ({ id, label, unit, expenseType:'MATERIAL' });
const cement = [product('329', 'CIMENTO CP IV 50 KG'), product('587', 'CIMENTO CP II'),
  product('55', 'BLOCO DE CIMENTO (PISO)', 'UN')];
const invoice = { supplier:'ML COMERCIO CIMENTO', taxId:'12345678000190', type:'NF-e', number:'18', key:'1'.repeat(44) };
const fiscal = description => ({ issueDate:'2026-11-18', dueDate:'2026-12-02', total:'610.00', lines:[
  { number:'1', description, unit:'SC', quantity:'25', unitPrice:'24.4', discount:'0', adjustment:'0' },
] });
const catalog = products => ({ products, history:[],
  suppliers:[{ id:'s', label:invoice.supplier, taxId:invoice.taxId, branch:'004 - EDIFÍCIO XAVANTE', account:'BOLETO' }],
  branches:[{ id:'b', label:'004 - EDIFÍCIO XAVANTE' }], accounts:[{ id:'a', label:'BOLETO' }],
  stages:[{ id:'e1', label:'ESTRUTURA', branch:'004 - EDIFÍCIO XAVANTE' },
    { id:'e2', label:'ALVENARIA', branch:'004 - EDIFÍCIO XAVANTE' }],
});
function suggest(description, products = cement, unit = 'SC') {
  const document = fiscal(description);
  document.lines[0].unit = unit;
  return buildNfeProposal(invoice, document, catalog(products)).lines[0].productId;
}

test('infers the actual registered CP IV without history and preserves the XML in both posting modes', () => {
  const document = fiscal('CIMENTO CPIV 32-RS'), choices = catalog(cement);
  const draft = buildNfeProposal(invoice, document, choices);
  assert.equal(draft.lines[0].productId, '329');
  assert.equal(draft.lines[0].stageId, '', 'cement alone does not identify its construction stage');
  draft.lines[0].stageId = 'e1';
  const launch = materializeNfeProposal(invoice, document, draft, choices).launchFields[0].fields;
  const provision = materializeNfeProvision(invoice, document, draft, choices).provisionFields[0].fields;
  assert.deepEqual([launch.field_7, launch.UN, launch.field_8, launch.field_9], ['CIMENTO CP IV 50 KG', 'SC', 25, 24.4]);
  assert.deepEqual([provision.PRODUTO, provision.QTD, provision.VALORTOTAL], ['CIMENTO CP IV 50 KG', '25', '24,4']);
});

test('recognizes compact, spaced and hyphenated technical classes and their registered alternatives', () => {
  for (const description of ['CIMENTO CPIV 32-RS', 'Cimento CP-IV 32 RS', 'CIMENTO CP IV 32-RS', 'CIMENTO CP4 32-RS']) {
    assert.equal(suggest(description), '329', description);
  }
  assert.equal(suggest('CIMENTO CPII 32'), '587');
});

test('prefers a compatible class but still selects the nearest material when only another class exists', () => {
  assert.equal(suggest('CIMENTO CPIV 32-RS', [cement[1]]), '587');
  assert.equal(suggest('CIMENTO CPV ARI', [cement[0]]), '329');
  assert.equal(suggest('AÇO CA60 8MM', [product('p', 'AÇO CA-50 8 MM', 'KG')], 'KG'), 'p');
  assert.equal(suggest('CIMENTO CPIV 32-RS'), '329');
});

test('uses technical specificity ahead of a generic catalog product', () => {
  assert.equal(suggest('CIMENTO CPIV 32-RS MARCA EXEMPLO', [...cement, product('generic', 'CIMENTO')]), '329');
});

test('prefers the declared package and selects a deterministic nearest package when it is unspecified', () => {
  const products = [cement[0], product('25', 'CIMENTO CP IV 25 KG')];
  assert.equal(suggest('CIMENTO CPIV 32-RS', products), '25');
  assert.equal(suggest('CIMENTO CPIV 32-RS', [...products].reverse()), '25');
  assert.equal(suggest('CIMENTO CPIV 32-RS 25KG', products), '25');
  assert.equal(suggest('CIMENTO CPIV 32-RS 25KG', [cement[0]]), '329');
});

test('equivalent fiscal and catalog units help resolve otherwise identical registrations', () => {
  const products = [product('kg', 'CIMENTO CP IV', 'KG'), product('bag', 'CIMENTO CP IV', 'SACO')];
  assert.equal(suggest('CIMENTO CPIV', products, 'SC'), 'bag');
  assert.equal(suggest('CIMENTO CPIV', products, ''), 'bag');
});

test('infers other catalog products with extra fiscal detail while respecting diameter and decimal precision', () => {
  const products = [product('8', 'AÇO CA-50 8 MM', 'KG'), product('10', 'AÇO CA-50 10 MM', 'KG'),
    product('125', 'AÇO CA-50 12,5 MM', 'KG')];
  assert.equal(suggest('ACO CA50 8MM BARRA GERDAU', products, 'KG'), '8');
  assert.equal(suggest('ACO CA50 12.5MM BARRA', products, 'KG'), '125');
  assert.equal(suggest('ACO CA50 12.5MM', [product('nearest', 'ACO CA50 125 MM', 'KG')], 'KG'), 'nearest');
});

test('selects the nearest variant even with sparse wording, leaving blank only unrelated descriptions', () => {
  assert.equal(suggest('CIMENTO', cement), '587');
  assert.equal(suggest('CIMENTO CPIV', [product('a', 'CIMENTO CPIV BRANCO'), product('b', 'CIMENTO CPIV CINZA')]), 'a');
  assert.equal(suggest('AREIA FINA', [product('grossa', 'AREIA GROSSA')]), 'grossa');
  assert.equal(suggest('PRODUTO 50 KG', [cement[0]], 'SACO'), '');
  assert.equal(suggest('DESCRIÇÃO DESCONHECIDA'), '');
});

test('recognizes minor spelling differences, plurals and known construction terminology', () => {
  assert.equal(suggest('CIMETO CPIV 32-RS'), '329');
  assert.equal(suggest('BLOCOS CONCRETO', [product('p', 'BLOCO DE CONCRETO', 'UN')], 'UN'), 'p');
  assert.equal(suggest('VERGALHAO CA50 8MM', [product('p', 'AÇO CA-50 8 MM', 'KG')], 'KG'), 'p');
});

test('a recognized technical class can identify a related material without spelling its family name', () => {
  assert.equal(suggest('CPIV 32-RS'), '329');
  assert.equal(suggest('CP-IV 32 RS'), '329');
  assert.equal(suggest('CA50 8MM', [product('steel', 'AÇO CA-50 8 MM', 'KG')], 'KG'), 'steel');
  assert.equal(suggest('CPV ARI', [cement[0]]), '329');
  assert.equal(suggest('50 KG', cement, 'SACO'), '');
});

test('technical differences lower the rank instead of eliminating the only related candidate', () => {
  const products = [product('wrong', 'ACO CA50 125 MM', 'KG'), product('right', 'ACO CA50 12,5 MM', 'KG')];
  assert.equal(suggest('ACO CA50 12.5MM', products, 'KG'), 'right');
  assert.equal(suggest('TUBO SEM ROSCA', [product('com', 'TUBO COM ROSCA'), product('sem', 'TUBO SEM ROSCA')]), 'sem');
  assert.equal(suggest('ACO CA50 12.5MM 6M BARRA PARA ESTRUTURA',
    [product('nearest', 'ACO CA60 125 MM 12 M GALVANIZADO REFORCADO ESPECIAL', 'KG')], 'TN'), 'nearest');
});

test('retains confirmed learning priority and obtains branch-compatible stage after catalog inference', () => {
  const choices = catalog(cement), document = fiscal('CIMENTO CPIV 32-RS');
  choices.learning = { product:() => '587', stage:() => '' };
  assert.equal(buildNfeProposal(invoice, document, choices).lines[0].productId, '587');
  const withHistory = { ...catalog(cement), history:[
    { product:'CIMENTO CP IV 50 KG', stage:'ESTRUTURA', branch:'004 - EDIFÍCIO XAVANTE' },
  ] };
  assert.equal(buildNfeProposal(invoice, document, withHistory).lines[0].stageId, 'e1');
});
