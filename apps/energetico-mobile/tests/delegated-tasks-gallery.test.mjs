import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';

test('Demandas puts delegated task history beside its creation without losing either existing gallery', () => {
  const dom = new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Bernardo' }, pendingFiles: [], draft: '', messages: [{
    id: 'demandas', role: 'assistant', type: 'poll', question: '📋 DEMANDAS\nQUAL FLUXO VOCÊ DESEJA INICIAR?',
    options: [['action_task', 'ADICIONAR UMA NOVA TAREFA'], ['action_delegated_task', 'CRIAR UMA TAREFA DELEGADA'], ['action_recurring_task_registration', 'CADASTRAR TAREFA RECORRENTE']].map(([id,label]) => ({ id, reply: id, label })),
  }] }));
  assert.deepEqual([...dom.window.document.querySelectorAll('.chat-menu-gallery-pair')].map(pair => [...pair.querySelectorAll('[data-reply-id]')].map(button => button.dataset.replyId)), [
    ['action_task', 'action_tasks_gallery'], ['action_delegated_task', 'action_delegated_tasks_gallery'], ['action_recurring_task_registration', 'action_recurring_tasks_gallery'],
  ]);
  dom.window.close();
});

test('G9 default selects both open statuses, sorts priority then fatal date and searches task number separately from SharePoint ID', async t => {
  const rows = [
    { id: '1', fields: { TAREFA: 'ALVENARIA', 'ID 2': 'D-104', 'CONCLUÍDO': 'ATIVIDADE CRIADA', 'PRIORITÁRIA': 'NÃO PRIORITÁRIA', 'DATA FATAL': '2026-10-01', 'ASSOCIAÇÃO': 'ETAPA A', DIFICULDADE: 'ALTA DIFICULDADE' }, hasAttachments: false },
    { id: '2', fields: { TAREFA: 'PINTURA', 'ID 2': 'D-105', 'CONCLUÍDO': 'EM ATENDIMENTO', 'PRIORITÁRIA': 'ATIVIDADE PRIORITÁRIA', 'DATA FATAL': '2026-10-03T03:00:00Z', 'ASSOCIAÇÃO': 'ETAPA B', DIFICULDADE: 'BAIXA DIFICULDADE' }, hasAttachments: false },
    { id: '3', fields: { TAREFA: 'PORTA', 'ID 2': 'D-106', 'CONCLUÍDO': 'CONCLUÍDO', 'PRIORITÁRIA': 'ATIVIDADE PRIORITÁRIA', 'DATA FATAL': '2026-10-02', 'DATA CONCLUSAO': '2026-10-02' }, hasAttachments: false },
    { id: '4', fields: { TAREFA: 'CONCRETO', 'ID 2': 'D-107', 'CONCLUÍDO': 'ATIVIDADE CRIADA', 'PRIORITÁRIA': 'ATIVIDADE PRIORITÁRIA', 'DATA FATAL': '2026-10-02' }, hasAttachments: false },
  ];
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: 'delegatedTasks', data: { async loadSnapshot() { return { rows }; } } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const ids = () => [...doc.querySelectorAll('[data-registration-row]')].map(row => row.dataset.registrationRow);
  assert.deepEqual(ids(), ['4','2','1']);
  const status = doc.querySelector('[data-filter-field="CONCLUÍDO"]');
  assert.equal(status.multiple, true);
  assert.deepEqual([...status.selectedOptions].map(option => option.value).sort(), ['ATIVIDADE CRIADA','EM ATENDIMENTO']);
  assert.ok(status.parentElement.querySelector('.sfs-search'), 'multi-status filter must also support option search');
  const search = doc.querySelector('input[type="search"]');
  search.value = 'D-105'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(ids(), ['2']);
  search.value = '2'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(ids(), [], 'SharePoint mutation ID is not the display/search ID 2');
  search.value = ''; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const date = doc.querySelector('[data-filter-field="DATA FATAL"]');
  assert.equal(date.type, 'date'); date.value = '2026-10-03'; date.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['2']);
  date.value = ''; date.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (const option of status.options) option.selected = option.value === 'CONCLUÍDO';
  status.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['3']);
  doc.querySelector('[data-gallery-action="delete"]').click();
  assert.match(doc.querySelector('[data-gallery-record-dialog]').textContent, /item de ID 3\?/);
});

test('G9 editing uses its full task form rather than the attachment-only form and preserves the hybrid responsible field', async () => {
  const data = createRegistrationGalleryData({ kind: 'delegatedTasks', repository: {
    async resolveList(site, aliases) { assert.equal(aliases[0], 'TAREFASDELEGADAS'); return { status: 'resolved', id: 'delegated' }; },
    async getColumns() { return ['TAREFA','RESPONS_x00c1_VEL','ASSOCIACAO','FILIAL','PRIORIT_x00c1_RIA','TIPO'].map(name => ({ name, displayName: name === 'ASSOCIACAO' ? 'ASSOCIAÇÃO' : name === 'RESPONS_x00c1_VEL' ? 'RESPONSÁVEL' : name, text: {} })); },
    async getItem(site, list, id) { return { id, eTag: '"v1"', fields: { TAREFA: 'TAREFA', RESPONS_x00c1_VEL: 'PESSOA AVULSA', FILIAL: 'A' } }; },
  } });
  const context = await data.loadEditor('5');
  assert.equal(context.contract.formVariant.formName, 'FORM.TAREFA_4');
  const responsible = context.columns.find(column => column.name === 'RESPONS_x00c1_VEL');
  assert.equal(responsible.control, 'text');
  assert.equal(responsible.editable, true);
  assert.notEqual(responsible.powerApps?.closed, true);
  const stage = context.columns.find(column => column.name === 'ASSOCIACAO');
  assert.equal(stage.powerApps.optionSources[0].kind, 'dependent');
  assert.equal(stage.powerApps.optionSources[0].listName, 'LANCAMENTOOBRA');
  await assert.rejects(data.loadEditor('5', { formVariantId: 'G9- HISTÓRICO DELEGACAO.pa.yaml#Form17' }), /formulário/);
});

test('G9 cards calculate score, fatal-date notices and elapsed time using the source fields', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T15:00:00Z') });
  const dom = new JSDOM('<!doctype html><body></body>');
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'delegatedTasks', data: { async loadSnapshot() { return { rows: [
    { id: '1', fields: { TAREFA: 'VENCIDA', CONCLU_x00cd_DO: 'EM ATENDIMENTO', OData__x0049_D2: 'D-100', DIFICULDADE: 'MUITO ALTA DIFICULDADE', IMPACTO: 'ALTO IMPACTO', URGENCIA: 'ALTA URGÊNCIA', DATAFATAL: '2026-10-01', DATAIN_x00cd_CIO: '2026-09-30' }, hasAttachments: false },
    { id: '2', fields: { TAREFA: 'HOJE', CONCLU_x00cd_DO: 'ATIVIDADE CRIADA', DATAFATAL: '2026-10-03', DATAIN_x00cd_CIO: '2026-10-02' }, hasAttachments: false },
    { id: '3', fields: { TAREFA: 'AMANHÃ', CONCLU_x00cd_DO: 'ATIVIDADE CRIADA', DATAFATAL: '2026-10-04' }, hasAttachments: false },
    { id: '4', fields: { TAREFA: 'PRÓXIMA', CONCLU_x00cd_DO: 'ATIVIDADE CRIADA', DATAFATAL: '2026-10-09' }, hasAttachments: false },
    { id: '5', fields: { TAREFA: 'FINALIZADA', CONCLU_x00cd_DO: 'CONCLUÍDO', DATAFATAL: '2026-10-01', DATAIDENTIFICACAO: '2026-09-27', DATACONCLUSAO0: '2026-10-02', DIFICULDADE: 'MÉDIA DIFICULDADE', IMPACTO: 'MÉDIO IMPACTO', URGENCIA: 'MÉDIA URGÊNCIA' }, hasAttachments: false },
  ] }; } } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const row = id => dom.window.document.querySelector(`[data-registration-row="${id}"]`);
  const value = (id, field) => row(id).querySelector(`[data-field="${field}"] dd`)?.textContent;
  assert.equal(value('1', 'PONTUAÇÃO'), '5');
  assert.equal(value('1', 'PRAZO'), 'VENCIDO HÁ 2 DIAS');
  assert.equal(value('1', 'TEMPO'), 'CRIADO HÁ: 3 DIAS');
  assert.equal(row('1').querySelector('[data-field="PRAZO"]').dataset.tone, 'danger');
  assert.equal(value('2', 'PRAZO'), 'VENCE HOJE');
  assert.equal(value('3', 'PRAZO'), 'VENCE AMANHÃ');
  assert.equal(value('4', 'PRAZO'), 'VENCE EM 6 DIAS');
  const status = dom.window.document.querySelector('[data-filter-field="CONCLUÍDO"]');
  for (const option of status.options) option.selected = !option.value;
  status.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(value('5', 'PRAZO'), undefined, 'completed tasks have no deadline warning');
  assert.equal(value('5', 'TEMPO'), 'CONCLUÍDO EM 02/10/2026 (5 DIAS GASTOS)');
  assert.equal(value('5', 'PONTUAÇÃO'), '3');
  assert.equal(row('5').querySelector('[data-field="TEMPO"]').dataset.tone, 'success');
});
