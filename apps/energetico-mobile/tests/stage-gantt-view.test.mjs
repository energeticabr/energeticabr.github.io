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
  assert.equal(dialog.querySelector('.gantt-row--stage .gantt-row-text small'), null);
  assert.match(dialog.querySelector('select').textContent, /Obra A/);
  assert.match(dialog.querySelector('.gantt-bar[data-tone="ongoing"]').getAttribute('aria-label'), /01\/11\/2026.*Em Andamento/);
  assert.equal(dialog.querySelector('.gantt-bar-date--start')?.textContent, '01/11/2026');
  assert.equal(dialog.querySelector('.gantt-bar-date--end')?.textContent, 'Em andamento');

  toggle.click();
  assert.equal(toggle.textContent, '−');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const child = dialog.querySelector('.gantt-row--stage').nextElementSibling;
  assert.equal(child.querySelector('.gantt-label').textContent, 'Escavação');
  assert.equal(dialog.querySelector('.gantt-legend--activity')?.textContent, 'Trecho da etapa');
  assert.equal(child.querySelector('.gantt-name').tagName, 'STRONG');
  assert.ok(child.querySelector('.gantt-cluster--description .gantt-name'));
  assert.ok(dialog.querySelector('.gantt-row--stage .gantt-cluster--description .gantt-name'));
  assert.match(child.querySelector('.gantt-bar').getAttribute('aria-label'), /Parte de: Fundação/);
  assert.match(child.querySelector('.gantt-bar[data-tone="finished"]').getAttribute('aria-label'), /03\/11\/2026.*03\/11\/2026/);
  assert.equal(child.querySelector('.gantt-bar-date--start').textContent, '03/11/2026');
  assert.equal(child.querySelector('.gantt-bar-date--end').textContent, '03/11/2026');

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

test('GANTT mostra só o nome nos cartões sem ação e preserva datas e status nas barras', async t => {
  const dom = new JSDOM('<!doctype html>');
  t.after(() => dom.window.close());
  const view = createStageGanttView({ document: dom.window.document, data: {
    loadSnapshot: async () => ({ complete: true,
      launches: [{ id: 1, branch: 'Xavante', stage: 'Estrutura', type: 'ATIVIDADE COMUM',
        status: 'INICIADO', startDate: '2026-08-10', endDate: '2026-12-01' }],
      activities: [
        { id: 1, branch: 'Xavante', stage: 'Estrutura', activity: 'Parede', property: ' TODOS ',
          supplier: 'EDGAR NELSON DA SILVA', status: 'ATIVIDADE FINALIZADA', executionDate: '2026-06-19', plannedDate: '2026-09-14' },
        { id: 2, branch: 'Xavante', stage: 'Estrutura', activity: 'Gabarito', property: 'Casa 2',
          supplier: '', status: 'ATIVIDADE FINALIZADA', executionDate: '', plannedDate: '2026-09-07' },
        { id: 3, branch: 'Xavante', stage: 'Estrutura', activity: 'Armação', property: 'todos',
          supplier: '', status: 'ATIVIDADE INICIADA', executionDate: '2026-08-10', plannedDate: '2026-11-13' },
      ],
    }),
  }});
  t.after(() => view.destroy());
  await view.open();
  view.element.querySelector('.gantt-toggle').click();
  const rows = [...view.element.querySelectorAll('.gantt-row--stage,.gantt-row--activity')];
  const row = name => rows.find(node => node.querySelector('.gantt-name').textContent === name);
  for (const node of rows) {
    const label = node.querySelector('.gantt-row-text');
    assert.equal(label.textContent, label.querySelector('.gantt-name').textContent);
  }
  assert.equal(row('Parede').querySelector('.gantt-bar-date--start').textContent, '19/06/2026');
  assert.equal(row('Parede').querySelector('.gantt-bar-date--end').textContent, '14/09/2026');
  assert.equal(row('Gabarito').querySelector('.gantt-bar'), null);
  assert.equal(row('Armação').querySelector('.gantt-bar-date--end').textContent, 'Em andamento');
  assert.equal(row('Estrutura').querySelector('.gantt-bar-date--end').textContent, 'Em andamento');
  for (const node of rows) assert.doesNotMatch(node.textContent, /TODOS|Início|Fim|Hoje/i);
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

test('GANTT suprime etapas junto de INICIAR e deixa restaurá-las no filtro NÃO EXIBIR', async t => {
  const dom = new JSDOM('<!doctype html>');
  t.after(() => dom.window.close());
  const launches = [
    { id: '1', branch: 'Obra A', stage: 'Fundação', type: 'ATIVIDADE COMUM', status: 'NÃO INICIADO' },
    { id: '2', branch: 'Obra A', stage: 'Pintura', type: 'ATIVIDADE COMUM', status: 'FINALIZADO', visibility: 'NÃO EXIBIR', endDate: '2026-11-02' },
    { id: '3', branch: 'Obra B', stage: 'Estrutura', type: 'ATIVIDADE COMUM', status: 'INICIADO', startDate: '2026-11-01' },
    { id: '5', branch: 'Obra B', stage: 'Revestimento', type: 'ATIVIDADE COMUM', status: 'FINALIZADO', endDate: '2026-11-04' },
  ];
  const writes = [];
  const view = createStageGanttView({ document: dom.window.document, data: {
    async loadSnapshot() {
      return { complete: true, launches: [...launches], activities: [
        { id: '4', branch: 'Obra A', stage: 'Fundação', activity: 'Escavação', property: '',
          supplier: '', status: 'ATIVIDADE NÃO INICIADA' },
      ] };
    },
    async startStage() {},
    async setStageVisibility(id, visibility, { expectedStage, signal }) {
      assert.equal(signal.aborted, false);
      writes.push([id, visibility]);
      const index = launches.findIndex(row => row.id === id);
      assert.equal(expectedStage.stage, launches[index].stage);
      if (writes.length === 1) throw new Error('Falha de conexão');
      launches[index] = { ...launches[index], visibility };
      return launches[index];
    },
  }});
  t.after(() => view.destroy());
  await view.open();
  const root = view.element;
  const filial = root.querySelector('.gantt-tools select');
  const display = root.querySelector('.gantt-visibility-filter');
  const stages = () => [...root.querySelectorAll('.gantt-row--stage .gantt-name')].map(row => row.textContent);
  const change = (select, value) => {
    select.value = value;
    select.dispatchEvent(new dom.window.Event('change'));
  };
  const wait = () => new Promise(resolve => setImmediate(resolve));
  const popup = () => root.querySelector('.gantt-visibility-confirm');
  const press = text => [...popup().querySelectorAll('button')].find(node => node.textContent === text).click();
  const actionFor = name => [...root.querySelectorAll('.gantt-row--stage')]
    .find(row => row.querySelector('.gantt-name').textContent === name)?.querySelector('.gantt-visibility-button') ?? null;

  assert.equal(display.value, 'EXIBIR');
  assert.deepEqual(stages(), ['Estrutura', 'Fundação', 'Revestimento']);
  assert.equal(actionFor('Estrutura'), null);
  assert.equal(actionFor('Revestimento'), null);
  change(filial, 'Obra A');
  assert.deepEqual(stages(), ['Fundação']);
  root.querySelector('.gantt-toggle').click();
  assert.ok(root.querySelector('.gantt-row--activity'));
  assert.equal(root.querySelector('.gantt-row--activity .gantt-visibility-button'), null);
  const suppress = root.querySelector('.gantt-visibility-button');
  assert.equal(suppress.textContent, 'SUPRIMIR');
  assert.equal(suppress.nextElementSibling.textContent, 'INICIAR');
  suppress.click();
  assert.equal(popup().hidden, false);
  assert.match(popup().textContent, /certeza.*suprimir.*Fundação/i);
  assert.match(popup().getAttribute('aria-label'), /Fundação.*Obra A/);
  const tab = shiftKey => dom.window.document.activeElement.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey }),
  );
  assert.equal(dom.window.document.activeElement.textContent, 'CANCELAR');
  tab(true);
  assert.equal(dom.window.document.activeElement.textContent, 'SIM');
  tab(false);
  assert.equal(dom.window.document.activeElement.textContent, 'CANCELAR');
  assert.equal(writes.length, 0);
  press('CANCELAR');
  assert.equal(popup().hidden, true);
  assert.equal(dom.window.document.activeElement, suppress);
  suppress.click();
  popup().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(popup().hidden, true);
  assert.equal(writes.length, 0);
  suppress.click();
  press('SIM');
  assert.equal(suppress.nextElementSibling.getAttribute('aria-disabled'), 'true');
  suppress.nextElementSibling.click();
  assert.equal(root.querySelector('.gantt-finish-overlay').hidden, true);
  await wait();
  assert.deepEqual(stages(), ['Fundação']);
  assert.match(root.querySelector('.gantt-notice').textContent, /não foi possível/i);
  suppress.click();
  press('SIM');
  press('SIM');
  await wait();
  assert.deepEqual(stages(), []);
  assert.equal(root.querySelector('.gantt-row--activity'), null);

  change(display, 'NÃO EXIBIR');
  assert.deepEqual(stages(), ['Fundação', 'Pintura']);
  assert.ok(root.querySelector('.gantt-row--activity'));
  const restore = root.querySelector('.gantt-visibility-button');
  assert.equal(restore.textContent, 'EXIBIR');
  assert.equal(actionFor('Pintura').textContent, 'EXIBIR');
  restore.click();
  assert.match(popup().textContent, /certeza.*exibir.*Fundação/i);
  assert.equal(writes.length, 2);
  press('CANCELAR');
  assert.equal(writes.length, 2);
  restore.click();
  press('SIM');
  await wait();
  assert.deepEqual(stages(), ['Pintura']);
  root.querySelector('[aria-label="Atualizar GANTT"]').click();
  await wait();
  assert.equal(display.value, 'NÃO EXIBIR');
  assert.deepEqual(stages(), ['Pintura']);
  change(display, 'EXIBIR');
  assert.deepEqual(stages(), ['Fundação']);
  assert.deepEqual(writes, [['1', 'NÃO EXIBIR'], ['1', 'NÃO EXIBIR'], ['1', 'EXIBIR']]);
});
