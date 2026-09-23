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
