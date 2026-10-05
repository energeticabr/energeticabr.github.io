import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

async function setup(t, overrides = {}) {
  const { data: dataOverrides, ...galleryOverrides } = overrides;
  const module = await import("../src/ui/tasks-gallery-view.js");
  assert.equal(typeof module.createTasksGallery, "function", "createTasksGallery must be implemented");
  const dom = new JSDOM("<main id=app></main>", { url: "https://example.test" });
  const document = dom.window.document;
  const calls = [];
  const rows = overrides.rows || [
    { id: "176", hasAttachments: true, fields: { "ID 2": "176", TAREFA: "Revisar lançamento de obra", STATUS: "EM ATENDIMENTO", "PRIORITÁRIA": "SIM", COBRAR: "SIM", FILIAL: "000 - ESCRITÓRIO CENTRAL", "DATA IDENTIFICAÇÃO": "2026-09-22T03:00:00Z", "DATA INÍCIO": "2026-09-23T03:00:00Z", field_7: "2026-10-03T03:00:00Z", "Criado por": "Bernardo Notini", "Modificado por": "Bernardo Notini", "Criado": "2026-09-22T12:00:00Z", "Modificado": "2026-09-23T12:00:00Z", REFERENTE: "EDIFÍCIO CENTRAL", field_10: "OBRA A", IMPACTO: "ALTO IMPACTO", DIFICULDADE: "MÉDIA DIFICULDADE", URGÊNCIA: "ALTA URGÊNCIA", "OBSERVAÇÕES CONCLUSÃO": "Texto <img src=x onerror=alert(1)>" } },
    { id: "175", hasAttachments: false, fields: { "ID 2": "175", TAREFA: "Comprar materiais", "CONCLUÍDO": true, "DATA IDENTIFICAÇÃO": "2026-09-21T03:00:00Z", FILIAL: "004 - EDIFÍCIO XAVANTE" } },
  ];
  const data = {
    async loadSnapshot(options) { calls.push(["snapshot", options]); return { listName: "LANCAMENTOTAREFAS", rows }; },
    async listAttachments(id, options) { assert.deepEqual(options, { refresh: true }); calls.push(["listAttachments", id]); return [{ fileName: "tarefa.pdf", mimeType: "application/pdf", size: 512 }]; },
    async downloadAttachment(id, name) { calls.push(["downloadAttachment", id, name]); return new Blob(["pdf"], { type: "application/pdf" }); },
    ...dataOverrides,
  };
  const gallery = module.createTasksGallery({ document, data, ...galleryOverrides });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, data, calls, root: () => document.querySelector(".tg-overlay") };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('mais à direita dos filtros inicia uma nova tarefa e fecha a galeria uma única vez', async t => {
  let creates = 0;
  const ctx = await setup(t, { onCreate: () => { creates++; } });
  await ctx.gallery.open();
  const toolbar = ctx.root().querySelector('.tg-toolbar');
  const button = toolbar.querySelector('[data-action="create-task"]');
  assert.ok(button, 'atalho de nova tarefa presente');
  assert.equal(button.previousElementSibling, toolbar.querySelector('.tg-filter-toggle'));
  assert.equal(button.textContent, '+');
  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('aria-label'), 'Adicionar uma nova tarefa');
  const style = ctx.document.createElement('style');
  style.textContent = await readFile(new URL('../src/ui/tasks-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(style);
  assert.equal(ctx.dom.window.getComputedStyle(button).backgroundColor, 'rgb(255, 255, 255)');
  assert.equal(ctx.dom.window.getComputedStyle(button).color, 'rgb(33, 132, 67)');
  button.click(); button.click();
  assert.equal(creates, 1);
  assert.equal(ctx.root().hidden, true);
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const completionContext = id => ({
  entity: { id: 'lancamentos-de-tarefas', title: 'Tarefa' },
  item: { id, fields: { field_8: '', field_12: 'EM ATENDIMENTO', field_11: 'Não alterar descrição' } },
  columns: [
    { name: 'field_8', label: 'DATA CONCLUSÃO', control: 'date', editable: true },
    { name: 'field_12', label: 'CONCLUÍDO', control: 'text', editable: true },
    { name: 'field_11', label: 'TAREFA', control: 'text', editable: true },
  ], contract: { hasForm: true, readOnly: false },
});
async function openCompletion(ctx) {
  const trigger = ctx.root().querySelector('.tg-card[data-item-id="176"] [data-action="complete"]');
  assert.ok(trigger, 'check de conclusão deve existir acima da seta');
  trigger.focus(); trigger.click();
  for (let attempt = 0; attempt < 20 && !ctx.root().querySelector('[data-task-completion-form]'); attempt++) await settle();
  return ctx.root().querySelector('.tg-completion-dialog');
}

test('check verde abre apenas data conclusão e concluído; cancelar não grava e restaura foco', async t => {
  let writes = 0;
  const ctx = await setup(t, { now: () => new Date('2026-10-04T01:30:00Z'), data: {
    loadEditor: async id => completionContext(id), saveEditor: async () => { writes++; },
  } });
  const style = ctx.document.createElement('style');
  style.textContent = await readFile(new URL('../src/ui/tasks-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(style);
  await ctx.gallery.open();
  const trigger = ctx.root().querySelector('[data-action="complete"]');
  assert.ok(trigger, 'ação de conclusão presente');
  assert.equal(ctx.dom.window.getComputedStyle(trigger).backgroundColor, 'rgb(37, 162, 78)');
  assert.equal(trigger.nextElementSibling.dataset.action, 'expand');
  const dialog = await openCompletion(ctx);
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.deepEqual([...dialog.querySelectorAll('input')].map(input => [input.name, input.value]), [
    ['completionDate', '2026-10-03'], ['completed', 'CONCLUÍDA'],
  ], 'data do dia em São Paulo, não o dia UTC');
  assert.equal(dialog.querySelectorAll('input, select, textarea').length, 2);
  assert.equal(ctx.root().querySelector('.og-content').inert, true);
  dialog.querySelector('[data-task-completion-cancel]').click();
  assert.equal(writes, 0);
  assert.equal(ctx.root().querySelector('.tg-completion-dialog'), null);
  assert.equal(ctx.root().querySelector('.og-content').inert, false);
  assert.equal(ctx.document.activeElement, trigger);
});

test('submeter conclusão grava só os dois nomes internos e retorna à galeria atualizada', async t => {
  const writes = [], saving = deferred();
  const ctx = await setup(t, { now: () => new Date('2026-10-03T12:00:00Z'), data: {
    loadEditor: async id => completionContext(id),
    saveEditor: async (context, fields) => { writes.push([context.item.id, fields]); await saving.promise; ctx.data.loadSnapshot = async () => ({ rows: [] }); },
  } });
  await ctx.gallery.open();
  const dialog = await openCompletion(ctx);
  dialog.querySelector('[name="completionDate"]').value = '2026-10-02';
  const submit = dialog.querySelector('[data-task-completion-submit]');
  submit.click(); submit.click();
  assert.deepEqual(writes, [['176', { field_8: '2026-10-02', field_12: 'CONCLUÍDA' }]]);
  assert.equal(submit.disabled, true);
  assert.equal(dialog.querySelector('[data-task-completion-cancel]').disabled, true);
  saving.resolve(); await settle(); await settle();
  assert.equal(ctx.root().querySelector('.tg-completion-dialog'), null);
  assert.equal(ctx.root().hidden, false);
  assert.equal(ctx.root().querySelectorAll('.tg-card').length, 0);
  assert.equal(ctx.document.activeElement, ctx.root(), 'foco permanece na galeria após recriar cartões');
});

test('falha de leitura após save verifica os campos antes de permitir nova gravação', async t => {
  let writes = 0, reads = 0;
  const baseline = { ...completionContext('176'), item: { ...completionContext('176').item, eTag: '"v1"' } };
  const ctx = await setup(t, { now: () => new Date('2026-10-03T12:00:00Z'), data: {
    loadEditor: async () => {
      reads++;
      if (reads === 2) throw new Error('Leitura indisponível');
      return reads === 1 ? baseline : { ...baseline, item: { id: '176', eTag: '"v2"', fields: { field_8: '2026-10-03', field_12: 'CONCLUÍDA' } } };
    },
    saveEditor: async () => { writes++; throw new Error('Leitura após gravação indisponível'); },
  } });
  await ctx.gallery.open();
  const dialog = await openCompletion(ctx);
  dialog.querySelector('[data-task-completion-submit]').click(); await settle(); await settle();
  assert.equal(writes, 1);
  assert.equal(dialog.querySelector('[name="completionDate"]').disabled, true, 'não altera um envio ainda não reconciliado');
  dialog.querySelector('[data-task-completion-submit]').click(); await settle(); await settle();
  assert.equal(writes, 1, 'o envio já reconhecido não é repetido com ETag antigo');
  assert.equal(ctx.root().querySelector('.tg-completion-dialog'), null);
});

test('Shift Tab no foco inicial do popup fica no último controle habilitado', async t => {
  const waiting = deferred();
  const ctx = await setup(t, { data: { loadEditor: async () => waiting.promise } });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-action="complete"]').click();
  const dialog = ctx.root().querySelector('.tg-completion-dialog');
  assert.equal(ctx.document.activeElement, dialog);
  dialog.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(ctx.document.activeElement, dialog.querySelector('[data-task-completion-cancel]'));
});

test('serviço real reconcilia escrita confirmada cuja leitura posterior falhou sem novo PATCH', async t => {
  const { createTasksGalleryData } = await import('../src/chat/orders-gallery-data.js');
  let writes = 0, reads = 0, fields = { field_8: '', field_12: 'EM ATENDIMENTO', field_11: 'Descrição original', STATUS: 'EM ATENDIMENTO' };
  const data = createTasksGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'tasks' }; },
    async getItemsPage() { return { items: [{ id: '176', fields }], hasMore: false }; },
    async getItem(_site, _list, id) { reads++; return { id, fields, eTag: writes ? '"v2"' : '"v1"' }; },
    async getColumns() { return [
      { name: 'field_8', displayName: 'DATA CONCLUSÃO', dateTime: { format: 'dateOnly' } },
      { name: 'field_12', displayName: 'CONCLUÍDO', text: {} },
      { name: 'field_11', displayName: 'TAREFA', text: {}, required: true },
    ]; },
    async updateItem(_site, _list, _id, values, options) {
      assert.deepEqual(options, { eTag: '"v1"' }); writes++; fields = { ...fields, ...values };
      throw new Error('GET após PATCH falhou');
    },
  } });
  const ctx = await setup(t, { now: () => new Date('2026-10-03T12:00:00Z'), data });
  await ctx.gallery.open();
  const dialog = await openCompletion(ctx);
  dialog.querySelector('[data-task-completion-submit]').click(); await settle(); await settle();
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.equal(fields.field_11, 'Descrição original');
  assert.equal(ctx.root().querySelector('.tg-completion-dialog'), null);
  assert.equal(ctx.root().querySelectorAll('.tg-card').length, 0);
});

test('data vazia impede gravação; falha no save mantém valores para tentar novamente', async t => {
  let writes = 0;
  const ctx = await setup(t, { data: {
    loadEditor: async id => completionContext(id),
    saveEditor: async () => { writes++; throw new Error('Sem conexão'); },
  } });
  await ctx.gallery.open();
  const dialog = await openCompletion(ctx), form = dialog.querySelector('form'), date = dialog.querySelector('[name="completionDate"]');
  date.value = '';
  form.dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(writes, 0);
  date.value = '2026-10-01';
  dialog.querySelector('[data-task-completion-submit]').click(); await settle();
  assert.equal(writes, 1);
  assert.match(dialog.querySelector('[role="alert"]').textContent, /Sem conexão/);
  assert.equal(date.value, '2026-10-01');
  assert.equal(dialog.querySelector('[data-task-completion-submit]').disabled, false);
});

test('conclusão salva com falha de refresh repete só a consulta, não a gravação', async t => {
  let writes = 0, failRefresh = false;
  const ctx = await setup(t, { data: {
    loadEditor: async id => completionContext(id),
    saveEditor: async () => { writes++; failRefresh = true; },
    loadSnapshot: async () => { if (failRefresh) throw new Error('Consulta indisponível'); return { rows: [{ id: '176', fields: { STATUS: 'EM ATENDIMENTO' } }] }; },
  } });
  await ctx.gallery.open();
  const dialog = await openCompletion(ctx);
  dialog.querySelector('[data-task-completion-submit]').click(); await settle(); await settle();
  assert.equal(writes, 1);
  assert.match(dialog.querySelector('[role="alert"]').textContent, /salva.*atualizar/i);
  failRefresh = false;
  dialog.querySelector('[data-task-completion-submit]').click(); await settle(); await settle();
  assert.equal(writes, 1);
  assert.equal(ctx.root().querySelector('.tg-completion-dialog'), null);
});

test('fechar popup durante leitura ignora resposta tardia e campos não comprovados bloqueiam save', async t => {
  const loading = deferred(); let writes = 0;
  const ctx = await setup(t, { data: { loadEditor: async () => loading.promise, saveEditor: async () => { writes++; } } });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-action="complete"]').click();
  ctx.root().querySelector('[data-task-completion-cancel]').click();
  loading.resolve(completionContext('176')); await settle();
  assert.equal(ctx.root().querySelector('.tg-completion-dialog'), null);
  ctx.data.loadEditor = async id => ({ ...completionContext(id), columns: [] });
  ctx.root().querySelector('[data-action="complete"]').click(); await settle();
  assert.match(ctx.root().querySelector('.tg-completion-dialog [role="alert"]').textContent, /campos|metadados/i);
  assert.equal(ctx.root().querySelector('[data-task-completion-form]'), null);
  assert.equal(writes, 0);
});
function button(root, label) {
  const found = [...root.querySelectorAll("button")].find(node => node.textContent.trim() === label && !node.closest("[hidden]"));
  assert.ok(found, `visible button: ${label}`);
  return found;
}
function setFilter(ctx, name, value) {
  const control = ctx.root().querySelector(`[name="${name}"]`);
  assert.ok(control, `filter ${name} exists`);
  control.value = value;
  control.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
}

test("Galeria G7 exibe métricas e filtros reais e formata datas em dd/mm/aaaa", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  assert.equal(ctx.root().getAttribute("role"), "dialog");
  assert.equal(ctx.root().querySelector("details.og-filters")?.open, false, "filtros de tarefas começam recolhidos");
  assert.match(ctx.root().querySelector("h1").textContent, /GALERIA TAREFAS/i);
  for (const name of ["search", "status", "priority", "charge", "branch", "association", "identificationDate"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `G7 filter ${name}`);
  }
  assert.match(ctx.root().querySelector(".tg-metrics").textContent, /Concluídas[\s\S]*Pendentes[\s\S]*Total/i);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /03\/10\/2026/);
  assert.doesNotMatch(ctx.root().querySelector(".tg-cards").textContent, /2026-10-03T03:00:00Z/);
  assert.equal(ctx.root().querySelector(".tg-cards img, .tg-cards [onerror]"), null);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /Revisar lançamento de obra/);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /PRIORITÁRIA/);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /COBRAR/);
});

test("G7 considera concluída somente a tarefa com data de conclusão preenchida", async t => {
  const ctx = await setup(t, { now: () => new Date("2026-10-02T12:00:00Z"), rows: [
    { id: "101", fields: { TAREFA: "Data preenchida", STATUS: "ATIVIDADE CRIADA", "CONCLUÍDO": false, "DATA CONCLUSÃO": "2026-10-01T15:00:00Z" } },
    { id: "102", fields: { TAREFA: "Alias interno", STATUS: "EM ATENDIMENTO", DATACONCLUSAO: "2026-10-02T15:00:00Z" } },
    { id: "103", fields: { TAREFA: "Sem data", STATUS: "CONCLUÍDA", "CONCLUÍDO": true, "DATA CONCLUSÃO": "" } },
    { id: "104", fields: { TAREFA: "Aberta", STATUS: "ATIVIDADE CRIADA" } },
  ] });
  await ctx.gallery.open();
  const metric = label => [...ctx.root().querySelectorAll(".tg-metrics .og-metric")]
    .find(item => item.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent;
  assert.equal(metric("Total"), "4");
  assert.equal(metric("Concluídas"), "2");
  assert.equal(metric("Pendentes"), "2");
  setFilter(ctx, "status", "");
  assert.match(ctx.root().querySelector('.tg-card[data-item-id="101"]').textContent, /CONCLUÍDA/);
  assert.doesNotMatch(ctx.root().querySelector('.tg-card[data-item-id="103"]').textContent, /CONCLUÍDA/);
});

test("G7 reconhece os nomes internos SharePoint dos campos da tarefa", async t => {
  const ctx = await setup(t, { rows: [
    { id: "301", fields: { field_11: "Descrição vinda do SharePoint", field_1: "ATIVIDADE EMERGENCIAL", field_7: "2026-10-05T03:00:00Z", field_8: "2026-10-02T03:00:00Z", field_10: "ADMINISTRATIVO", STATUS: "ATIVIDADE CRIADA" } },
    { id: "302", fields: { field_11: "Tarefa aberta", field_8: null, STATUS: "ATIVIDADE CRIADA" } },
  ] });
  await ctx.gallery.open();
  const metric = label => [...ctx.root().querySelectorAll(".tg-metrics .og-metric")]
    .find(item => item.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent;
  assert.equal(metric("Concluídas"), "1");
  setFilter(ctx, "status", "");
  const card = ctx.root().querySelector('.tg-card[data-item-id="301"]');
  assert.match(card.textContent, /Descrição vinda do SharePoint/);
  assert.match(card.textContent, /ATIVIDADE EMERGENCIAL/);
  assert.match(card.textContent, /05\/10\/2026/);
  assert.match(card.textContent, /ADMINISTRATIVO/);
  assert.match(card.textContent, /CONCLUÍDA/);
});

test("G7 prefere a tarefa do SharePoint ao Title técnico mesmo quando Title vem primeiro", async t => {
  const ctx = await setup(t, { rows: [
    { id: "401", fields: { Title: "WA-task-55c38f1ee7b027a86624a63d", field_11: "CONFERIR CONTRATO E DOCUMENTOS", STATUS: "ATIVIDADE CRIADA" } },
    { id: "402", fields: { Title: "WA-task-aba", TAREFA: "", field_11: "REVISAR ORÇAMENTO", STATUS: "EM ATENDIMENTO" } },
    { id: "403", fields: { Title: "WA-task-sem-texto", field_11: "", STATUS: "ATIVIDADE CRIADA" } },
  ] });
  await ctx.gallery.open();
  assert.equal(ctx.root().querySelector('.tg-card[data-item-id="401"] .tg-description')?.textContent, "CONFERIR CONTRATO E DOCUMENTOS");
  assert.equal(ctx.root().querySelector('.tg-card[data-item-id="402"] .tg-description')?.textContent, "REVISAR ORÇAMENTO");
  assert.equal(ctx.root().querySelector('.tg-card[data-item-id="403"] .tg-description')?.textContent, "Tarefa sem descrição");
});

test("G7 distingue concluídas, pendentes e total e colore datas de criação e modificação", async t => {
  const ctx = await setup(t);
  const css = await readFile(new URL("../src/ui/tasks-gallery.css", import.meta.url), "utf8");
  const style = ctx.document.createElement("style");
  style.textContent = css;
  ctx.document.head.append(style);
  await ctx.gallery.open();
  const metrics = [...ctx.root().querySelectorAll(".tg-metrics .tg-metric")];
  assert.deepEqual(metrics.map(metric => metric.querySelector("dt")?.textContent), ["Concluídas", "Pendentes", "Total"]);
  assert.equal(ctx.dom.window.getComputedStyle(metrics[1]).backgroundColor, "rgb(255, 239, 239)");
  assert.equal(ctx.dom.window.getComputedStyle(metrics[1].querySelector("dt")).color, "rgb(172, 39, 49)");
  assert.equal(ctx.dom.window.getComputedStyle(metrics[1].querySelector("dd")).color, "rgb(172, 39, 49)");
  assert.equal(ctx.dom.window.getComputedStyle(metrics[1].querySelector(".tg-metric-icon")).backgroundColor, "rgb(197, 46, 58)");
  const card = ctx.root().querySelector('.tg-card[data-item-id="176"]');
  const created = card.querySelector(".tg-card-times .tg-created");
  const modified = card.querySelector(".tg-card-times .tg-modified");
  assert.match(created?.textContent || "", /Criado em/);
  assert.match(modified?.textContent || "", /Mod\. em/);
  assert.equal(ctx.dom.window.getComputedStyle(created).color, "rgb(24, 117, 66)");
  assert.equal(ctx.dom.window.getComputedStyle(modified).color, "rgb(172, 39, 49)");
});

test("pesquisa e filtros da G7 refinam a lista localmente sem novas escritas", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  const search = ctx.root().querySelector('[name="search"]');
  search.value = "Revisar lançamento";
  setFilter(ctx, "priority", "SIM");
  await settle();
  assert.deepEqual([...ctx.root().querySelectorAll(".tg-card")].map(card => card.dataset.itemId), ["176"]);
  assert.match(ctx.root().querySelector(".tg-list-status").textContent, /1 tarefa/i);
  assert.equal([...ctx.root().querySelectorAll("button")].some(node => node.textContent.trim() === "Aplicar filtros"), false);
});

test("G7 filtra por padrão atividades criadas ou em atendimento e mantém o status individual", async t => {
  const rows = [
    { id: "101", fields: { "ID 2": "101", TAREFA: "Atividade criada", STATUS: "ATIVIDADE CRIADA" } },
    { id: "102", fields: { "ID 2": "102", TAREFA: "Em atendimento", STATUS: "EM ATENDIMENTO" } },
    { id: "103", fields: { "ID 2": "103", TAREFA: "Não iniciada", STATUS: "NÃO INICIADA" } },
    { id: "104", fields: { "ID 2": "104", TAREFA: "Concluída", STATUS: "CONCLUÍDA" } },
  ];
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();

  const status = ctx.root().querySelector('[name="status"]');
  assert.equal(status.selectedOptions[0].textContent, "ATIVIDADE CRIADA OU EM ATENDIMENTO");
  assert.deepEqual([...ctx.root().querySelectorAll(".tg-card")].map(card => card.dataset.itemId).sort(), ["101", "102"]);

  setFilter(ctx, "status", "EM ATENDIMENTO");
  assert.deepEqual([...ctx.root().querySelectorAll(".tg-card")].map(card => card.dataset.itemId), ["102"]);
  button(ctx.root(), "Limpar filtros").click();
  assert.equal(status.selectedOptions[0].textContent, "ATIVIDADE CRIADA OU EM ATENDIMENTO");
  assert.deepEqual([...ctx.root().querySelectorAll(".tg-card")].map(card => card.dataset.itemId).sort(), ["101", "102"]);
});

test("G7 oferece EM ATENDIMENTO mesmo quando nenhum registro tem esse status", async t => {
  const ctx = await setup(t, { rows: [
    { id: "201", fields: { "ID 2": "201", TAREFA: "Atividade criada", STATUS: "ATIVIDADE CRIADA" } },
  ] });
  await ctx.gallery.open();

  const status = ctx.root().querySelector('[name="status"]');
  assert.ok([...status.options].some(option => option.value === "EM ATENDIMENTO"));
  assert.equal(status.selectedOptions[0].textContent, "ATIVIDADE CRIADA OU EM ATENDIMENTO");
});

test("toques em opções de ordenação e status aplicam os filtros da galeria", async t => {
  const ctx = await setup(t, { rows: [
    { id: "100", fields: { TAREFA: "Primeira", STATUS: "ATIVIDADE CRIADA", field_7: "2026-10-01T03:00:00Z" } },
    { id: "200", fields: { TAREFA: "Segunda", STATUS: "EM ATENDIMENTO", field_7: "2026-10-03T03:00:00Z" } },
  ] });
  await ctx.gallery.open();
  const ids = () => [...ctx.root().querySelectorAll(".tg-card")].map(card => card.dataset.itemId);
  assert.deepEqual(ids(), ["100", "200"]);

  for (const [name, label] of [["sort", "ID (maior primeiro)"], ["status", "EM ATENDIMENTO"]]) {
    const native = ctx.root().querySelector(`[name="${name}"]`);
    const picker = native.nextElementSibling;
    picker.querySelector(".sfs-trigger").click();
    const option = [...picker.querySelectorAll(".sfs-option")].find(item => item.textContent === label);
    assert.ok(option, `${name} option exists`);
    option.dispatchEvent(new ctx.dom.window.MouseEvent("pointerdown", { bubbles: true }));
    picker.querySelector(".sfs-search").dispatchEvent(new ctx.dom.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    assert.equal(picker.querySelector(".sfs-popup").hidden, false, `${name} remains open until the tap selects an option`);
    option.dispatchEvent(new ctx.dom.window.MouseEvent("pointerup", { bubbles: true }));
    option.click();
    if (name === "sort") assert.deepEqual(ids(), ["200", "100"], "new sort order is applied to the records");
  }

  assert.deepEqual(ids(), ["200"]);
  assert.equal(ctx.root().querySelector('[name="sort"]').value, "id-desc");
  assert.equal(ctx.root().querySelector('[name="status"]').value, "EM ATENDIMENTO");
});

test("tarefa abre seus campos pelo lápis e anexos no visualizador compartilhado", async t => {
  const opened = [];
  const ctx = await setup(t, { openMediaCollection: async items => opened.push(items), data: {
    async loadEditor(id) {
      return {
        entity: { id: "tarefas", title: "Tarefa" },
        item: { id, fields: { "OBSERVAÇÕES CONCLUSÃO": "Texto <img src=x onerror=alert(1)>" } },
        columns: [{ name: "OBSERVAÇÕES CONCLUSÃO", label: "Observações conclusão", control: "textarea", editable: true }],
        contract: { hasForm: true },
      };
    },
  } });
  await ctx.gallery.open();
  ctx.root().querySelector('.tg-card[data-item-id="176"] [data-gallery-action="edit"]').click();
  for (let attempt = 0; attempt < 20 && !ctx.root().querySelector('[data-dynamic-form]'); attempt++) await settle();
  assert.equal(ctx.root().querySelector('[data-dynamic-form] [name="OBSERVAÇÕES CONCLUSÃO"]').value,
    "Texto <img src=x onerror=alert(1)>");
  assert.equal(ctx.root().querySelector("[onerror]"), null);
  assert.equal(ctx.root().querySelector('.tg-description[data-action="details"]'), null);
  ctx.root().querySelector('[data-form-cancel]').click();
  await settle();
  ctx.root().querySelector('.tg-card[data-item-id="176"] [data-action="attachments"]').click();
  await settle();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].map(item => item.fileName), ["tarefa.pdf"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
});

test("tarefas mostram a quantidade de anexos abaixo do ícone no trilho esquerdo", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  await settle();
  const rail = ctx.root().querySelector('.tg-card[data-item-id="176"] .og-card-attachment-rail');
  assert.ok(rail);
  assert.equal(rail.querySelector(".og-card-attachment-icon").textContent, "📎");
  assert.equal(rail.querySelector(".og-card-attachment-label").textContent, "ANEXOS");
  assert.equal(rail.querySelector(".og-card-attachment-count").textContent, "1 anexo");
});

test("G7 só exibe a bandeja de anexos quando existe ao menos um arquivo", async t => {
  const ctx = await setup(t, { rows: [
    { id: "201", hasAttachments: false, fields: { TAREFA: "Nenhum arquivo", STATUS: "ATIVIDADE CRIADA" } },
    { id: "202", hasAttachments: null, fields: { TAREFA: "Quantidade desconhecida", STATUS: "ATIVIDADE CRIADA" } },
    { id: "203", hasAttachments: true, fields: { TAREFA: "Sinalizador desatualizado", STATUS: "ATIVIDADE CRIADA" } },
    { id: "204", hasAttachments: null, fields: { TAREFA: "Com arquivo", STATUS: "ATIVIDADE CRIADA" } },
  ], data: { async listAttachments(id) { return id === "204" ? [{ fileName: "arquivo.pdf" }] : []; } } });
  await ctx.gallery.open();
  await settle();
  for (const id of ["201", "202", "203"]) {
    const card = ctx.root().querySelector(`.tg-card[data-item-id="${id}"]`);
    assert.equal(card.querySelector(".og-card-attachment-rail"), null, `tarefa ${id} não mostra anexos vazios`);
    assert.doesNotMatch(card.textContent, /0 anexos|ANEXOS|Contando anexos/i);
  }
  const populated = ctx.root().querySelector('.tg-card[data-item-id="204"]');
  assert.equal(populated.querySelector(".og-card-attachment-count")?.textContent, "1 anexo");
});

test("consulta de anexos que falhou permite repetir sem mostrar clipe de arquivo inexistente", async t => {
  let attempts = 0;
  const ctx = await setup(t, { rows: [
    { id: "205", hasAttachments: true, fields: { TAREFA: "Revisar contrato", STATUS: "ATIVIDADE CRIADA" } },
  ], data: { async listAttachments() {
    attempts++;
    if (attempts === 1) throw new Error("falha temporária");
    return [{ fileName: "contrato.pdf" }];
  } } });
  await ctx.gallery.open();
  await settle();
  let card = ctx.root().querySelector('.tg-card[data-item-id="205"]');
  assert.equal(card.querySelector(".og-card-attachment-rail"), null);
  setFilter(ctx, "status", "");
  card = ctx.root().querySelector('.tg-card[data-item-id="205"]');
  const retry = card.querySelector('[data-action="retry-attachments"]');
  assert.ok(retry, "falha oferece nova consulta fora da bandeja de anexos");
  retry.click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(card.querySelector(".og-card-attachment-count")?.textContent, "1 anexo");
  assert.equal(card.querySelector('[data-action="retry-attachments"]'), null);
});

test("G7 apresenta três indicadores, busca compacta e linhas alternadas com ações preservadas", async t => {
  const ctx = await setup(t, { rows: [
    { id: "201", fields: { TAREFA: "Verificar orçamento", STATUS: "ATIVIDADE CRIADA", "GRAU URGÊNCIA": "ATIVIDADE EMERGENCIAL", "ASSOCIAÇÃO": "COMPRAS E SUPRIMENTOS", field_7: "2026-10-05T03:00:00Z", Criado: "2026-10-01T12:00:00Z" } },
    { id: "202", fields: { TAREFA: "Revisar documento", STATUS: "EM ATENDIMENTO", "PRIORITÁRIA": true, "ASSOCIAÇÃO": "ADMINISTRATIVO", field_7: "2026-10-06T03:00:00Z" } },
  ] });
  await ctx.gallery.open();
  assert.deepEqual([...ctx.root().querySelectorAll(".tg-metrics dt")].map(node => node.textContent), ["Concluídas", "Pendentes", "Total"]);
  assert.ok(ctx.root().querySelector('.tg-toolbar [name="search"]'), "search appears outside collapsed filters");
  assert.ok(ctx.root().querySelector(".tg-toolbar .tg-filter-toggle"));
  const shown = [...ctx.root().querySelectorAll(".tg-card")];
  assert.deepEqual(shown.map(card => card.dataset.itemId), ["201", "202"]);
  assert.ok(shown[0].classList.contains("tg-card--light"));
  assert.ok(shown[1].classList.contains("tg-card--blue"));
  assert.match(shown[0].textContent, /ATIVIDADE EMERGENCIAL/);
  assert.match(shown[0].textContent, /COMPRAS E SUPRIMENTOS/);
  assert.match(shown[0].textContent, /05\/10\/2026/);
  assert.equal(shown[0].querySelector('.tg-description[data-action="details"]'), null, "task description is not a separate details shortcut");
  assert.equal(shown[0].querySelector('.tg-description').tagName, "P");
  assert.ok(shown[0].querySelector('.gallery-record-actions [data-gallery-action="edit"]'));
  assert.ok(shown[0].querySelector('.gallery-record-actions [data-gallery-action="delete"]'));
});

test("seta de expansão só habilita quando a descrição não cabe e abre o texto inteiro", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.tg-card[data-item-id="176"]');
  const description = card.querySelector('.tg-description');
  const expand = card.querySelector('[data-action="expand"]');
  assert.ok(description);
  assert.ok(expand);
  Object.defineProperties(description, { scrollHeight: { configurable: true, value: 42 }, clientHeight: { configurable: true, value: 42 } });
  ctx.dom.window.dispatchEvent(new ctx.dom.window.Event("resize"));
  assert.equal(expand.disabled, true, "texto que cabe mantém a seta desabilitada");
  Object.defineProperty(description, "scrollHeight", { configurable: true, value: 90 });
  ctx.dom.window.dispatchEvent(new ctx.dom.window.Event("resize"));
  assert.equal(expand.disabled, false, "texto cortado habilita a seta");
  expand.click();
  assert.equal(description.classList.contains("tg-description--expanded"), true);
  assert.equal(expand.getAttribute("aria-expanded"), "true");
  expand.click();
  assert.equal(description.classList.contains("tg-description--expanded"), false);
});

test("prévia da tarefa mostra quatro linhas completas com reticências e expande sem corte", async t => {
  const ctx = await setup(t);
  const css = await readFile(new URL("../src/ui/tasks-gallery.css", import.meta.url), "utf8");
  const style = ctx.document.createElement("style");
  style.textContent = css;
  ctx.document.head.append(style);
  await ctx.gallery.open();
  const description = ctx.root().querySelector('.tg-card[data-item-id="176"] .tg-description');
  const collapsed = ctx.dom.window.getComputedStyle(description);
  assert.equal(collapsed.display, "-webkit-box");
  assert.equal(collapsed.getPropertyValue("-webkit-line-clamp"), "4");
  assert.equal(collapsed.lineHeight, "1.3");
  assert.equal(collapsed.overflow, "hidden");
  Object.defineProperties(description, { scrollHeight: { configurable: true, value: 100 }, clientHeight: { configurable: true, value: 65 } });
  ctx.dom.window.dispatchEvent(new ctx.dom.window.Event("resize"));
  ctx.root().querySelector('.tg-card[data-item-id="176"] [data-action="expand"]').click();
  const expanded = ctx.dom.window.getComputedStyle(description);
  assert.equal(expanded.display, "block");
  assert.equal(expanded.getPropertyValue("-webkit-line-clamp"), "none");
  assert.equal(expanded.overflow, "visible");
});

test("seta de expansão é um ícone geométrico centrado no botão", async t => {
  const ctx = await setup(t);
  const styles = await Promise.all([
    "../src/ui/gallery-record-actions.css", "../src/ui/tasks-gallery.css",
  ].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  const style = ctx.document.createElement("style");
  style.textContent = styles.join("\n");
  ctx.document.head.append(style);
  await ctx.gallery.open();
  const expand = ctx.root().querySelector('.tg-card[data-item-id="176"] [data-action="expand"]');
  assert.equal(expand.textContent, "", "a posição não depende da linha de base de um caractere de fonte");
  assert.ok(expand.querySelector("svg path"));
  const layout = ctx.dom.window.getComputedStyle(expand);
  assert.equal(layout.display, "inline-flex");
  assert.equal(layout.alignItems, "center");
  assert.equal(layout.justifyContent, "center");
});

test("retorno ao menu e fechamento limpam a sessão visual da galeria", async t => {
  let home = 0;
  const ctx = await setup(t, { onHome: () => { home++; } });
  await ctx.gallery.open();
  button(ctx.root(), "Início").click();
  assert.equal(home, 1);
  ctx.gallery.close();
  assert.equal(ctx.root().hidden, true);
});
