import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStageGanttView } from '../src/ui/stage-gantt-view.js';

test('GANTT expande as atividades abaixo da etapa e exibe datas e estados das barras', async t => {
  const dom = new JSDOM('<!doctype html><button data-action="open-stage-gantt">GANTT</button>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  dom.window.innerWidth = 390;
  dom.window.innerHeight = 844;
  const view = createStageGanttView({ document, now: () => new Date(2026, 10, 16), data: {
    loadSnapshot: async () => ({ complete: true,
      launches: [{ id: 1, branch: 'Obra A', stage: 'Fundação', type: 'ATIVIDADE COMUM', status: 'INICIADO', startDate: '2026-11-01' }],
      activities: [{ id: 2, branch: 'Obra A', stage: 'Fundação', activity: 'Escavação', property: 'Casa 2',
        supplier: '', status: 'ATIVIDADE FINALIZADA', executionDate: '2026-11-03', plannedDate: '2026-11-03' }],
    }),
  }});
  t.after(() => view.destroy());
  const home = document.querySelector('button');
  home.focus();
  await view.open();
  const dialog = view.element;
  assert.equal(dialog.dataset.reportPortrait, 'true');
  assert.equal(dialog.style.getPropertyValue('--report-height'), '390px');
  const toggle = dialog.querySelector('button[aria-expanded]');
  assert.equal(toggle.textContent, '+');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(dialog.querySelectorAll('.gantt-row--activity').length, 0);
  assert.match(dialog.querySelector('[data-tone="ongoing"]').getAttribute('aria-label'), /01\/11\/2026.*Hoje.*16\/11\/2026/);

  toggle.click();
  assert.equal(toggle.textContent, '−');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const child = dialog.querySelector('.gantt-row--stage').nextElementSibling;
  assert.match(child.textContent, /Escavação.*Casa 2/);
  assert.match(child.querySelector('[data-tone="finished"]').getAttribute('aria-label'), /03\/11\/2026.*03\/11\/2026/);

  dom.window.innerWidth = 844;
  dom.window.innerHeight = 390;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(dialog.dataset.reportPortrait, 'false');
  assert.equal(dialog.querySelector('.gantt-row--activity'), child);
  toggle.click();
  assert.equal(dialog.querySelectorAll('.gantt-row--activity').length, 0);
  dialog.querySelector('button[aria-label="Fechar GANTT"]').click();
  assert.equal(dialog.hidden, true);
  assert.equal(document.activeElement, home);
});

test('GANTT abre em Xavante, permite trocar a filial e mantém a escolha ao atualizar', async t => {
  const dom = new JSDOM('<!doctype html>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const view = createStageGanttView({
    document,
    data: { loadSnapshot: async () => ({
      complete: true,
      launches: [
        { id: 1, branch: '004 - EDIFÍCIO XAVANTE', stage: 'Fundação', type: 'ATIVIDADE COMUM', status: 'INICIADO', startDate: '2026-11-01' },
        { id: 2, branch: '001 - OURO PRETO', stage: 'Pintura', type: 'ATIVIDADE COMUM', status: 'INICIADO', startDate: '2026-11-03' },
      ],
      activities: [],
    }) },
  });
  t.after(() => view.destroy());
  await view.open();

  const select = view.element.querySelector('select');
  const renderedStages = () => [...view.element.querySelectorAll('.gantt-row--stage .gantt-name')].map(node => node.textContent);
  assert.equal(select.value, '004 - EDIFÍCIO XAVANTE');
  assert.deepEqual(renderedStages(), ['Fundação']);

  select.value = '001 - OURO PRETO';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(renderedStages(), ['Pintura']);

  const refresh = view.element.querySelector('[aria-label="Atualizar GANTT"]');
  refresh.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(select.value, '001 - OURO PRETO');
  assert.deepEqual(renderedStages(), ['Pintura']);

  view.close();
  await view.open();
  assert.equal(select.value, '004 - EDIFÍCIO XAVANTE');
  assert.deepEqual(renderedStages(), ['Fundação']);
});
