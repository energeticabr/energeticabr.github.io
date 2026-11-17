import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as data from '../src/chat/nfe-proposal-data.js';
import { provisionChildrenTotal } from '../../../portal/forms/provision-parent-workflow.js';
import {
  buildNfeProposal, updateNfeProposalSupplier, updateNfeProposalBranch, updateNfeProposalProduct, validateNfeProposal,
} from '../src/chat/nfe-proposal-model.js';

const catalog = {
  suppliers:[
    { id:'1', label:'OUTRO FORNECEDOR', taxId:'', branch:'MATRIZ', account:'' },
    { id:'2', label:'AÇO EXEMPLO LTDA.', taxId:'12345678000190', branch:'OBRA', account:'BOLETO' },
  ],
  branches:[{ id:'10',label:'MATRIZ',unit:'000' }, { id:'11',label:'OBRA',unit:'001' }],
  accounts:[{ id:'20',label:'BOLETO' }],
  products:[
    { id:'30',label:'AÇO CA-50 8 MM',expenseType:'MATERIAL',unit:'KG' },
    { id:'31',label:'AREIA FINA',expenseType:'MATERIAL',unit:'KG' },
  ],
  stages:[
    { id:'40',label:'ESTRUTURA',branch:'OBRA' },
    { id:'41',label:'FUNDAÇÃO',branch:'OBRA' },
    { id:'42',label:'FUNDAÇÃO',branch:'MATRIZ' },
    { id:'43',label:'CANTEIRO',branch:'MATRIZ' },
  ],
  history:[
    { product:'AÇO CA-50 8 MM', stage:'ESTRUTURA', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'ESTRUTURA', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'FUNDAÇÃO', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'FUNDAÇÃO', branch:'MATRIZ' },
    { product:'AREIA FINA', stage:'CANTEIRO', branch:'MATRIZ' },
  ],
};
const invoice = { supplier:'Aco Exemplo', taxId:'12.345.678/0001-90' };
const fiscal = { issueDate:'2026-11-08', dueDate:'2026-11-15', total:'19.50', lines:[
  { number:'1', description:'AÇO CA-50 8MM', unit:'KG', quantity:'2', unitPrice:'10', adjustment:'0.50', discount:'1' },
] };

test('provision respects the fiscal line quantity and net total with text currency and earliest reviewed due date', () => {
  const second = { ...fiscal.lines[0], number:'2', quantity:'3', unitPrice:'10', adjustment:'0', discount:'1' };
  const document = { ...fiscal, total:'48.50', lines:[fiscal.lines[0], second] };
  const draft = buildNfeProposal(invoice, document, catalog);
  draft.lines[1].dueDate = '2026-11-12';
  const result = data.materializeNfeProvision({ type:'NF-e',number:'17',key:'example' }, document, draft, catalog);
  assert.equal(result.parentFields.VALORTOTAL, '48,5');
  assert.equal(result.parentFields.DATAPREVISTOPGTO.slice(0,10), '2026-11-12');
  assert.deepEqual(result.provisionFields.map(({ fields }) => fields.QTD), ['2','3']);
  assert.deepEqual(result.provisionFields.map(({ fields }) => fields.PGTOAGENDADO), ['PENDENTE','PENDENTE']);
  const names = { QTD:'QTD', VALORTOTAL:'VALORTOTAL', FRETE:'FRETE' };
  assert.equal(provisionChildrenTotal(result.provisionFields, names), '48.5');
  draft.lines[1].dueDate = '';
  assert.throws(() => data.materializeNfeProvision(invoice, document, draft, catalog), /vencimento.*2/i);
});

test('proposes the exact supplier registration, its branch, known product and most used eligible stage', () => {
  const draft = buildNfeProposal(invoice, fiscal, catalog);
  assert.deepEqual([draft.supplierId,draft.branchId,draft.accountId,draft.date], ['2','11','20','2026-11-08']);
  assert.deepEqual(draft.lines.map(line=>[line.number,line.productId,line.stageId,line.date,line.dueDate]),
    [['1','30','40','2026-11-08','2026-11-15']]);
  const valid = validateNfeProposal(draft, fiscal, catalog);
  assert.equal(valid.total,'19.50');
  assert.equal(valid.lines[0].netAdjustment,-0.5);
});

test('a provision accepts no account and retains a registered account when selected', () => {
  const draft = buildNfeProposal(invoice, fiscal, catalog);
  const row = { type:'NF-e', number:'17', key:'example' };
  const selected = data.materializeNfeProvision(row, fiscal, draft, catalog);
  assert.equal(selected.parentFields.FORMAPGTO, 'BOLETO');
  assert.equal(selected.provisionFields[0].fields.FORMAPGTO, 'BOLETO');

  draft.accountId = '';
  const optional = data.materializeNfeProvision(row, fiscal, draft, catalog);
  assert.equal(optional.draft.accountId, '');
  assert.equal(optional.parentFields.FORMAPGTO, null);
  assert.equal(optional.provisionFields[0].fields.FORMAPGTO, null);
  assert.throws(() => data.materializeNfeProposal(row, fiscal, draft, catalog), /conta/i);
  assert.throws(() => data.materializeNfeProvision(row, fiscal, { ...draft, accountId:'999' }, catalog), /conta/i);
  assert.throws(() => data.materializeNfeProvision(row, fiscal, { ...draft, supplierId:'' }, catalog), /fornecedor/i);
});

test('branch, supplier and product edits recompute stages from the selected branch only', () => {
  const original = buildNfeProposal(invoice, fiscal, catalog);
  const branch = updateNfeProposalBranch(original, '10', catalog);
  assert.equal(branch.lines[0].stageId,'42');
  const product = updateNfeProposalProduct(branch, '1', '31', catalog);
  assert.equal(product.lines[0].stageId,'43');
  const supplier = updateNfeProposalSupplier(product, '2', catalog);
  assert.equal(supplier.branchId,'11');
  assert.equal(supplier.lines[0].stageId,'');
  const tampered = { ...original, lines:[{ ...original.lines[0], stageId:'42' }] };
  assert.throws(()=>validateNfeProposal(tampered,fiscal,catalog),/etapa/i);
});

test('stage fallback follows the recent product history of the selected branch', () => {
  const recent = [
    { product:'AÇO CA-50 8 MM', stage:'FUNDAÇÃO', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'ESTRUTURA', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'FUNDAÇÃO', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'ESTRUTURA', branch:'OBRA' },
    { product:'AÇO CA-50 8 MM', stage:'FUNDAÇÃO', branch:'OBRA' },
  ];
  const history = [...recent, ...Array(10).fill(recent[1])];
  assert.equal(buildNfeProposal(invoice, fiscal, { ...catalog, history }).lines[0].stageId, '41');
  const otherBranch = [{ ...recent[0], branch:'MATRIZ' }];
  assert.equal(buildNfeProposal(invoice, fiscal, { ...catalog, history:otherBranch }).lines[0].stageId, '');
});

test('unknown products require a real catalog selection and financial edits retain the fiscal line identities', () => {
  const current = { ...fiscal, lines:[{ ...fiscal.lines[0], description:'DESCRIÇÃO DESCONHECIDA' }] };
  const draft = buildNfeProposal(invoice, current, catalog);
  assert.equal(draft.lines[0].productId,'');
  assert.throws(()=>validateNfeProposal(draft,current,catalog),/produto/i);
  const edited = updateNfeProposalProduct(draft,'1','30',catalog);
  edited.lines[0].quantity = '2,5';
  assert.equal(validateNfeProposal(edited,current,catalog).total,'24.50');
  edited.lines[0].number = '2';
  assert.throws(()=>validateNfeProposal(edited,current,catalog),/linhas/i);
});


test('uses the original unit price and cent-exact financial adjustment with standard approval defaults', async () => {
  const { materializeNfeProposal } = await import('../src/chat/nfe-proposal-data.js');
  const Decimal = (await import('decimal.js')).default;
  const current = { ...fiscal, total:'0.91', lines:[{ ...fiscal.lines[0],
    quantity:'3', unitPrice:'0.33333', adjustment:'0.01', discount:'0.10' }] };
  const draft = buildNfeProposal(invoice, current, catalog);
  const row = { ...invoice, type:'NF-e', number:'18', key:'1'.repeat(44) };
  const plan = materializeNfeProposal(row, current, draft, catalog);
  assert.equal(plan.orderFields.VALORTOTAL, '0,91');
  assert.equal(plan.orderFields.NOTAFISCAL, 'SUBMETIDO');
  const fields = plan.launchFields[0].fields;
  assert.equal(fields.field_9, 0.33333);
  assert.equal(fields.field_14, 'BOLETO');
  assert.equal(fields.APROVACAO, 'PENDENTE DE APROVAÇÃO');
  assert.equal(new Decimal(fields.field_8).times(fields.field_9).plus(fields.field_10).toFixed(2), '0.91');
  assert.equal('field_4' in fields, false);
});

test('uses the fiscal unit without a checkbox or quantity conversion despite the catalog unit', () => {
  const current = { ...fiscal, total:'769.00', lines:[{ ...fiscal.lines[0], unit:'TN',
    quantity:'8.4', unitPrice:'91.54762', discount:'0', adjustment:'0' }] };
  const draft = buildNfeProposal(invoice, current, catalog);
  // A caller cannot replace the XML unit through an editable or stale draft.
  draft.lines[0].unit = 'KG';
  const row = { type:'NF-e', number:'175754', key:'example' };
  const launch = data.materializeNfeProposal(row, current, draft, catalog);
  assert.equal(launch.launchFields[0].fields.UN, 'TN');
  assert.equal(launch.launchFields[0].fields.field_8, 8.4);
  assert.equal(launch.launchFields[0].fields.field_9, 91.54762);
  assert.equal(launch.orderFields.VALORTOTAL, '769,00');
  const provision = data.materializeNfeProvision(row, current, draft, catalog);
  assert.equal(provision.draft.lines[0].unit, 'TN');
  assert.equal(provision.provisionFields[0].fields.QTD, '8,4');
  assert.match(provision.provisionFields[0].fields.OBS, /8\.4 TN/);
  assert.equal(provision.parentFields.VALORTOTAL, '769');
  assert.equal(catalog.products[0].unit, 'KG');
});

test('fiscal unit works without a catalog unit and catalog is only a fallback for a unitless invoice', () => {
  const withoutUnit = { ...catalog, products:catalog.products.map(product => ({ ...product, unit:'' })) };
  const draft = buildNfeProposal(invoice, fiscal, withoutUnit);
  assert.equal(validateNfeProposal(draft, fiscal, withoutUnit).lines[0].unit, 'KG');
  const unitless = { ...fiscal, lines:[{ ...fiscal.lines[0], unit:'  ' }] };
  assert.equal(validateNfeProposal(draft, unitless, catalog).lines[0].unit, 'KG');
  assert.throws(() => validateNfeProposal(draft, unitless, withoutUnit), /unidade/i);
});

test('legacy reserved plans retain their frozen draft and financial unit semantics', () => {
  const current = { ...fiscal, lines:[{ ...fiscal.lines[0], unit:'TN' }] };
  const reserved = { supplierId:'2', branchId:'11', accountId:'20', date:'2026-11-08',
    lines:[{ number:'1', productId:'30', stageId:'40', quantity:'2', unitPrice:'10',
      adjustment:'0.50', discount:'1.00', date:'2026-11-08', dueDate:'2026-11-15', unitReviewed:true }] };
  const row = { type:'NF-e', number:'175754', key:'example' };
  const launch = data.materializeNfeProposal(row, current, reserved, catalog, { legacyUnits:true });
  assert.deepEqual(launch.draft, reserved);
  assert.equal(launch.launchFields[0].fields.UN, 'KG');
  const provision = data.materializeNfeProvision(row, current, reserved, catalog, { legacyUnits:true });
  assert.deepEqual(provision.draft, reserved);
  assert.equal(provision.provisionFields[0].fields.OBS, 'NF-e nº 175754 · Item 1: AÇO CA-50 8MM');
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
  // Captured from the unchanged materializers at HEAD 24b0d55.
  assert.equal(hash(launch), 'b5dea5a0ad748263037eefae176facd9a0bce6022795daffa65a4432cf415624');
  assert.equal(hash(provision), 'bdcdf081f4a16bfd2cbb8e71ad8ce6d0a2dbee6246c1d2d3578f517256d280da');
  const fresh = data.materializeNfeProposal(row, current, reserved, catalog);
  assert.equal(fresh.launchFields[0].fields.UN, 'TN');
  assert.equal(fresh.draft.lines[0].unit, 'TN');
  assert.equal(Object.hasOwn(fresh.draft.lines[0], 'unitReviewed'), false);
});
