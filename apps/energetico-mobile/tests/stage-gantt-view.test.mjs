import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStageGanttView } from '../src/ui/stage-gantt-view.js';

test('GANTT expande as atividades abaixo da etapa e exibe datas e estados das barras', async t => {
  const dom = new JSDOM('<!doctype html><button data-action="open-stage-gantt">GANTT</button>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const view = createStageGanttView({ document, now: () => new Date(2026, 10, 16), data: {
    loadSnapshot: async () => ({ complete: true,
      launches: [{ id: 1, branch: 'Obra A', stage: 'Fundação', status: 'INICIADO', startDate: '2026-11-01' }],
      activities: [{ id: 2, branch: 'Obra A', stage: 'Fundação', activity: 'Escavação', property: 'Casa 2',
        supplier: '', status: 'ATIVIDADE FINALIZADA', executionDate: '2026-11-03', plannedDate: '2026-11-03' }],
    }),
  }});
  t.after(() => view.destroy());
  const home = document.querySelector('button');
  home.focus();
  await view.open();
  const dialog = view.element;
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

  toggle.click();
  assert.equal(dialog.querySelectorAll('.gantt-row--activity').length, 0);
  dialog.querySelector('button[aria-label="Fechar GANTT"]').click();
  assert.equal(dialog.hidden, true);
  assert.equal(document.activeElement, home);
});
