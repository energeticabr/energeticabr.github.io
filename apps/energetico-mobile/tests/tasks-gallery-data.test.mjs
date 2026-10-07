import test from "node:test";
import assert from "node:assert/strict";

async function taskGalleryDataFactory(t) {
  const module = await import("../src/chat/orders-gallery-data.js");
  assert.equal(typeof module.createTasksGalleryData, "function", "createTasksGalleryData must be implemented");
  return module.createTasksGalleryData;
}

test("carrega LANCAMENTOTAREFAS pela sessão SharePoint autenticada e mantém os campos G7", async t => {
  const createTasksGalleryData = await taskGalleryDataFactory(t);
  const calls = [];
  const repository = {
    async resolveList(...args) { calls.push(["resolveList", ...args]); return { status: "resolved", id: "list-tasks" }; },
    async getItemsPage(...args) {
      calls.push(["getItemsPage", ...args]);
      return { items: [
        { id: "176", fields: { "ID 2": "176", TAREFA: "Concluir projeto <script>alert(1)</script>", "CONCLUÍDO": false, "PRIORITÁRIA": "SIM", COBRAR: "SIM", FILIAL: "000 - ESCRITÓRIO CENTRAL", "DATA IDENTIFICAÇÃO": "2026-09-22T03:00:00Z", "DATA FATAL": "2026-10-03T03:00:00Z", "Criado por": { DisplayName: "Bernardo" }, Anexos: [{ name: "foto.jpg" }] } },
      ], nextLink: "", hasMore: false };
    },
    async listAttachments(...args) { calls.push(["listAttachments", ...args]); return [{ name: "foto.jpg", type: "image/jpeg", size: 4096 }]; },
    async downloadAttachment(...args) { calls.push(["downloadAttachment", ...args]); return new Blob(["img"], { type: "image/jpeg" }); },
  };

  const data = createTasksGalleryData({ repository });
  const snapshot = await data.loadSnapshot();
  assert.equal(snapshot.listName, "LANCAMENTOTAREFAS");
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].id, "176");
  assert.equal(snapshot.rows[0].fields.TAREFA, "Concluir projeto <script>alert(1)</script>");
  assert.equal(snapshot.rows[0].hasAttachments, true);
  assert.deepEqual(calls[0], ["resolveList", "personal", ["LANCAMENTOTAREFAS", "LANCAMENTO TAREFAS"], {}]);
  assert.deepEqual(await data.listAttachments("176"), [{ fileName: "foto.jpg", mimeType: "image/jpeg", size: 4096, uploadedAt: "" }]);
  assert.equal((await data.downloadAttachment("176", "foto.jpg")).type, "image/jpeg");
});

test("informa quando a lista G7 não está acessível à conta SharePoint autenticada", async t => {
  const createTasksGalleryData = await taskGalleryDataFactory(t);
  const data = createTasksGalleryData({ repository: {
    async resolveList() { return { status: "missing" }; },
    async getItemsPage() { throw new Error("não deveria consultar uma lista ausente"); },
  } });
  await assert.rejects(data.loadSnapshot(), error => error.code === "tasks_list_missing" && /LANCAMENTOTAREFAS/.test(error.message));
});

test('filtro G7 consulta todos os fornecedores ativos de mão de obra do escritório central', async t => {
  const createTasksGalleryData = await taskGalleryDataFactory(t);
  const calls = [], signal = new AbortController().signal;
  const fields = (Title, overrides = {}) => ({ Title, FILIAL: '000 - ESCRITÓRIO CENTRAL', field_1: 'MÃO DE OBRA', STATUS: 'ATIVO', ...overrides });
  const data = createTasksGalleryData({ repository: {
    async resolveList(site, aliases, options) { calls.push(['resolve', site, aliases, options]); return { status: 'resolved', id: aliases[0] }; },
    async getColumns() { return [
      { name: 'Title', displayName: 'CADASTRO' }, { name: 'FILIAL', displayName: 'FILIAL' },
      { name: 'field_1', displayName: 'TIPO' }, { name: 'STATUS', displayName: 'STATUS' },
    ]; },
    async getItemsPage(site, list, query, options) {
      calls.push(['page', site, list, query, options]);
      return options.cursor ? { items: [
        { id: '7', fields: fields('CODEX') }, { id: '8', fields: fields('BERNARDO') },
        { id: '9', fields: fields('NOVO FORNECEDOR SEM TAREFAS') },
      ], hasMore: false } : { items: [
        { id: '1', fields: fields('BERNARDO') },
        { id: '2', fields: fields('INATIVO', { STATUS: 'INATIVO' }) },
        { id: '3', fields: fields('OUTRA FILIAL', { FILIAL: '004 - EDIFÍCIO XAVANTE' }) },
        { id: '4', fields: fields('MATERIAL', { field_1: 'MATERIAL' }) },
        { id: '5', fields: fields('') },
      ], hasMore: true, nextLink: 'suppliers-page-2' };
    },
  } });
  assert.equal(typeof data.loadFilterOptions, 'function');
  assert.deepEqual(await data.loadFilterOptions('FORNECEDOR', { signal }), [
    { value: 'BERNARDO', label: 'BERNARDO' }, { value: 'CODEX', label: 'CODEX' },
    { value: 'NOVO FORNECEDOR SEM TAREFAS', label: 'NOVO FORNECEDOR SEM TAREFAS' },
  ]);
  assert.deepEqual(calls[0], ['resolve', 'personal', ['FORNECEDORES'], { signal }]);
  const pages = calls.filter(call => call[0] === 'page');
  assert.equal(pages.length, 2);
  assert.match(pages[0][3], /fields\(\$select=Title,FILIAL,field_1,STATUS\)/);
  assert.equal(pages[1][4].cursor, 'suppliers-page-2');
  assert.equal(pages[1][4].signal, signal);
});

test('conclusão rápida usa contrato real e envia somente data e concluído com ETag', async t => {
  const createTasksGalleryData = await taskGalleryDataFactory(t), writes = [];
  const data = createTasksGalleryData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'tasks' }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getItem(_site, _list, id) { return { id, eTag: '"task-v1"', fields: { field_8: '', field_12: 'EM ATENDIMENTO', field_11: 'Descrição preservada' } }; },
    async getColumns() { return [
      { name: 'field_8', displayName: 'DATA CONCLUSÃO', dateTime: { format: 'dateOnly' } },
      { name: 'field_12', displayName: 'CONCLUÍDO', text: {} },
      { name: 'field_11', displayName: 'TAREFA', text: {}, required: true },
    ]; },
    async updateItem(site, list, id, fields, options) { writes.push({ site, list, id, fields, options }); return { id, fields }; },
  } });
  const context = await data.loadEditor('176');
  assert.equal(context.contract.formVariant.formName, 'FORM.TAREFA_1');
  await data.saveEditor(context, { field_8: '2026-10-03', field_12: 'CONCLUÍDA' });
  assert.deepEqual(writes, [{ site: 'personal', list: 'tasks', id: '176',
    fields: { field_8: '2026-10-03', field_12: 'CONCLUÍDA' }, options: { eTag: '"task-v1"' } }]);
});
