import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildDdaReport, normalizeDdaReportRows } from '../src/chat/dda-report-model.js';
import { REGISTRATION_GALLERY_MODELS } from '../src/chat/registration-gallery-data.js';
import { createDdaReportView } from '../src/ui/dda-report-view.js';

const now = () => new Date('2026-11-25T12:00:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (id, due, priority) => ({
  id: String(id),
  fields: { Title: 'Fornecedor ' + id, CHAVE_DDA: 'dda-' + id, SITUACAO: 'Em aberto',
    VENCIMENTO: due, DATA_PRIOR: priority, VALOR: 100 },
});

test('priority changes the sort key only, including ties, absent and invalid dates', () => {
  assert.ok(REGISTRATION_GALLERY_MODELS.dda.restReadFields.includes('DATA_PRIOR'));
  const rows = normalizeDdaReportRows({ rows: [
    row(5, '2026-11-25'), row(2, '2027-01-04', '2026-11-24T12:00:00Z'),
    row(4, '2026-11-23', '2026-11-27'), row(1, '', '2026-11-24'),
    row(3, '2026-11-26', '2026-02-30'), row(6, ''),
  ] });
  const report = buildDdaReport(rows, undefined, now());
  assert.deepEqual(report.rows.map(item => item.id), ['1', '2', '5', '3', '4', '6']);
  assert.equal(report.rows[1].due, '2027-01-04');
  assert.equal(report.rows[1].priorityDate, '2026-11-24');
  assert.equal(report.today, 1);
  assert.equal(report.overdue, 1);
  assert.equal(report.dueWithin7Days, 2);
});

test('priority saves only the date, checks the item version, and reconciles retries', async () => {
  const { createDdaPriority } = await import('../src/chat/dda-priority.js');
  let live = { ...row(2, '2027-01-04'), eTag: '"3"' };
  const writes = [];
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'dda' }),
    getItem: async () => live,
    updateItem: async (_site, _list, _item, patch, options) => {
      writes.push({ patch, eTag: options.eTag });
      live = { ...live, fields: { ...live.fields, ...patch } };
      return live;
    },
  };
  const save = createDdaPriority({ repository });
  const selected = { id: '2', key: 'dda-2', priorityDate: '' };
  const options = { row: selected, priorityDate: '2026-11-24' };
  await assert.rejects(save({ ...options, priorityDate: '2026-02-30' }));
  await assert.rejects(save({ ...options, row: { ...selected, key: 'other' } }));
  assert.equal(writes.length, 0);
  const receipt = { id: '2', priorityDate: '2026-11-24' };
  assert.deepEqual(await save(options), receipt);
  assert.deepEqual(await save(options), receipt);
  assert.deepEqual(writes, [{ patch: { DATA_PRIOR: '2026-11-24T12:00:00Z' }, eTag: '"3"' }]);
  await assert.rejects(save({ ...options, priorityDate: '2026-11-30' }), /Atualize o relatório/);
  assert.equal(writes.length, 1);
  assert.equal(live.fields.VENCIMENTO, '2027-01-04');
});

test('priority dialog requires a date and saves, reloads and edits the priority below the bank status', async t => {
  const source = [row(1, '2026-11-25'), row(2, '2027-01-04')];
  const dom = new JSDOM('<body><main id="app"></main></body>');
  const doc = dom.window.document;
  const writes = [];
  let fail = true;
  const view = createDdaReportView({ document: doc, now, data: {
    loadSnapshot: async () => ({ rows: source }),
    async prioritizeDda({ row: selected, priorityDate }) {
      writes.push(priorityDate);
      if (fail) throw new Error('indisponível');
      source.find(item => item.id === selected.id).fields.DATA_PRIOR = priorityDate;
      return { id: selected.id, priorityDate };
    },
  } });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  const ids = () => [...doc.querySelectorAll('[data-dda-id]')].map(item => item.dataset.ddaId);
  const priority = () => doc.querySelector('[data-dda-prioritize="2"]');
  const dialog = () => doc.querySelector('[data-dda-priority-dialog]');
  const date = () => dialog().querySelector('input[type=date]');
  const save = () => dialog().querySelector('button[type=submit]');
  assert.equal(priority().closest('td').className, 'ddr-status');
  assert.equal(priority().textContent, 'PRIORIZAR');
  priority().click();
  assert.equal(dialog().getAttribute('aria-label'), 'Qual a data de priorização?');
  assert.equal(doc.activeElement, date());
  save().click();
  assert.deepEqual(writes, []);
  dialog().querySelector('button[aria-label="Cancelar"]').click();
  assert.equal(doc.activeElement, priority());
  priority().click();
  date().value = '2026-11-24';
  save().click();
  await tick();
  assert.ok(dialog().querySelector('[role=alert]'));
  assert.deepEqual(ids(), ['1', '2']);
  assert.equal(date().value, '2026-11-24');
  fail = false;
  save().click();
  save().click();
  await tick();
  assert.deepEqual(writes, ['2026-11-24', '2026-11-24']);
  assert.equal(dialog(), null);
  assert.equal(doc.activeElement, priority());
  assert.deepEqual(ids(), ['2', '1']);
  const prioritized = doc.querySelector('[data-dda-id="2"][data-dda-prioritized]');
  assert.match(prioritized.querySelector('.ddr-due-date').textContent, /^04\/01\/2027/);
  const cluster = prioritized.querySelector('.ddr-status-cluster');
  assert.equal(cluster.querySelector('strong').textContent, 'Em aberto');
  assert.equal(cluster.nextElementSibling.textContent, 'DATA PRIOR24/11/2026');
  view.close();
  await view.open();
  assert.deepEqual(ids(), ['2', '1']);
  priority().click();
  assert.equal(date().value, '2026-11-24');
  date().value = '2026-11-30';
  save().click();
  await tick();
  assert.deepEqual(ids(), ['1', '2']);
});
