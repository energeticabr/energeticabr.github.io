import test from 'node:test';
import assert from 'node:assert/strict';
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

test('proposes the exact supplier registration, its branch, known product and most used eligible stage', () => {
  const draft = buildNfeProposal(invoice, fiscal, catalog);
  assert.deepEqual([draft.supplierId,draft.branchId,draft.accountId,draft.date], ['2','11','20','2026-11-08']);
  assert.deepEqual(draft.lines.map(line=>[line.number,line.productId,line.stageId,line.date,line.dueDate]),
    [['1','30','40','2026-11-08','2026-11-15']]);
  const valid = validateNfeProposal(draft, fiscal, catalog);
  assert.equal(valid.total,'19.50');
  assert.equal(valid.lines[0].netAdjustment,-0.5);
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

test('requires a quantity review when the invoice and selected product use different units', () => {
  const current = { ...fiscal, lines:[{ ...fiscal.lines[0],unit:'CX' }] };
  const draft = buildNfeProposal(invoice, current, catalog);
  assert.throws(() => validateNfeProposal(draft,current,catalog), /unidade.*quantidade/i);
  draft.lines[0].unitReviewed = true;
  assert.equal(validateNfeProposal(draft,current,catalog).lines[0].unitReviewed, true);
});
