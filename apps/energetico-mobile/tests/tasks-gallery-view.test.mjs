import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function setup(t, overrides = {}) {
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
    async listAttachments(id) { calls.push(["listAttachments", id]); return [{ fileName: "tarefa.pdf", mimeType: "application/pdf", size: 512 }]; },
    async downloadAttachment(id, name) { calls.push(["downloadAttachment", id, name]); return new Blob(["pdf"], { type: "application/pdf" }); },
    ...overrides.data,
  };
  const gallery = module.createTasksGallery({ document, data, ...overrides });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, data, calls, root: () => document.querySelector(".tg-overlay") };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
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
  assert.match(ctx.root().querySelector("h1").textContent, /GALERIA TAREFAS/i);
  for (const name of ["search", "status", "priority", "charge", "branch", "association", "identificationDate"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `G7 filter ${name}`);
  }
  assert.match(ctx.root().querySelector(".tg-metrics").textContent, /Total[\s\S]*Concluídas[\s\S]*Pendentes/i);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /03\/10\/2026/);
  assert.doesNotMatch(ctx.root().querySelector(".tg-cards").textContent, /2026-10-03T03:00:00Z/);
  assert.equal(ctx.root().querySelector(".tg-cards img, .tg-cards [onerror]"), null);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /Revisar lançamento de obra/);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /PRIORITÁRIA/);
  assert.match(ctx.root().querySelector(".tg-cards").textContent, /COBRAR/);
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

test("detalhes mostram os campos completos em tabela e anexos abrem no visualizador compartilhado", async t => {
  const opened = [];
  const ctx = await setup(t, { openMediaCollection: async items => opened.push(items) });
  await ctx.gallery.open();
  button(ctx.root(), "Detalhes").click();
  const detail = ctx.root().querySelector(".tg-detail");
  assert.equal(detail.getAttribute("role"), "dialog");
  assert.ok(detail.querySelector("table"));
  assert.match(detail.textContent, /OBSERVAÇÕES CONCLUSÃO/);
  assert.match(detail.textContent, /Texto <img src=x onerror=alert\(1\)>/);
  assert.equal(detail.querySelector("img, [onerror]"), null);
  assert.match(detail.textContent, /23\/09\/2026/);
  button(detail, "Fechar detalhes").click();
  ctx.root().querySelector('.tg-card[data-item-id="176"] [data-action="attachments"]').click();
  await settle();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].map(item => item.fileName), ["tarefa.pdf"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
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
