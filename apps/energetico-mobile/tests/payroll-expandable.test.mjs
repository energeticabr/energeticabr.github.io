import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHrPayrollReport } from '../src/ui/hr-payroll-report-view.js';
import { createHrPayrollGallery } from '../src/ui/hr-payroll-gallery-view.js';

const rows = [
  {id:'2', TIPOPGTO:'SALÁRIO', VALORUNITARIO:250, QTD:2, DATA:'2026-09-28T00:00:00Z', IDLANCAMENTO:3456},
  {id:'3', TIPOPGTO:'Salario', VALORUNITARIO:'506,40', QTD:1, DATA:'2026-09-29', IDLANCAMENTO:3457},
  {id:'4', TIPOPGTO:'VALE REFEIÇÃO', VALORUNITARIO:109, QTD:1, DATA:'30/09/2026'},
];
const text = node => node.textContent.replace(/\u00a0/g, ' ').trim();

test('totais por tipo expandem uma linha por pagamento com ID, total e data, sem misturar tipos', async () => {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const report = createHrPayrollReport({root, request:async()=>rows});
  try {
    await report.open({id:'5', FORNECEDOR:'FELICIANO', MESREFERENCIA:'09/2026'});
    const salary = root.querySelector('[data-report-total-type="SALARIO"]').closest('details');
    assert.ok(salary, 'o total deve ser expansível');
    assert.equal(salary.open, false);
    assert.equal(text(salary.querySelector('summary')), 'SALÁRIO R$ 1.006,40');
    salary.querySelector('summary').click();
    assert.equal(salary.open, true);
    assert.deepEqual([...salary.querySelectorAll('li')].map(text), ['2 - R$ 500,00 (28/09/2026)', '3 - R$ 506,40 (29/09/2026)']);
    assert.doesNotMatch(text(salary), /3456|109,00/);
    salary.querySelector('summary').click();
    assert.equal(salary.open, false);
    const meal = root.querySelector('[data-report-total-type="VALEREFEICAO"]').closest('details');
    assert.equal(meal.open, false);
    meal.querySelector('summary').click();
    assert.deepEqual([...meal.querySelectorAll('li')].map(text), ['4 - R$ 109,00 (30/09/2026)']);
    assert.equal(text(root.querySelector('[data-report-total="overall"]')), 'R$ 1.115,40');
  } finally { report.destroy(); dom.window.close(); }
});

test('pagamentos vinculados começam recolhidos, abrem por clique e recolhem ao consultar outra folha', async () => {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const report = createHrPayrollReport({root, request:async()=>rows});
  try {
    await report.open({id:'5'});
    const section = root.querySelector('.hr-payroll-report-payments').closest('details');
    assert.ok(section, 'a lista de pagamentos deve ser suspensa');
    assert.equal(section.open, false);
    section.querySelector('summary').click();
    assert.equal(section.open, true);
    assert.equal(section.querySelectorAll('.hr-payroll-payment-card').length, 3);
    assert.match(text(section), /3456/);
    await report.open({id:'6'});
    assert.equal(section.open, false);
  } finally { report.destroy(); dom.window.close(); }
});

test('detalhe mantém pagamentos sem valor calculável, sem inventar zero para a linha', async () => {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const report = createHrPayrollReport({root, request:async()=>[{id:'9', TIPOPGTO:'SALÁRIO', QTD:1}]});
  try {
    await report.open({id:'5'});
    const salary = root.querySelector('[data-report-total-type="SALARIO"]').closest('details');
    assert.ok(salary);
    salary.querySelector('summary').click();
    assert.deepEqual([...salary.querySelectorAll('li')].map(text), ['9 - Não calculado (—)']);
    assert.match(text(root), /não entraram nos totais/);
  } finally { report.destroy(); dom.window.close(); }
});

test('atalho do relatório fica após excluir nas ações do cartão e ainda consulta a folha correta', async () => {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const requests = [];
  const gallery = createHrPayrollGallery({root, gallery:'IDFOLHA', request:async()=>({gallery:'IDFOLHA', page:1, rows:[{id:'5',FORNECEDOR:'FELICIANO', MESREFERENCIA:'09/2026'}]}), requestReport:async id=>{requests.push(id); return rows;}});
  try {
    await gallery.open();
    const actions = root.querySelector('.hr-gallery-card .gallery-record-actions');
    const button = actions.querySelector('[data-action="open-payroll-report"]');
    assert.ok(button, 'mascote deve ocupar a coluna de ações');
    assert.equal(button.previousElementSibling.dataset.galleryAction, 'delete');
    assert.equal(root.querySelector('.hr-gallery-card-header .report-mascot-button'), null);
    button.click();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(requests,['5']);
  } finally { gallery.destroy(); dom.window.close(); }
});
