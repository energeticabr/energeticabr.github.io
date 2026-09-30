import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const context = id => ({
  entity: { id: "test", title: "Registro" },
  columns: [{ name: "Title", label: "Título", control: "text", editable: true, hidden: false, required: true }],
  item: { id, fields: { Title: "Original" } },
  contract: { hasForm: true, readOnly: false },
});

async function setup(t, overrides = {}) {
  const { createGalleryRecordActions } = await import("../src/ui/gallery-record-actions.js");
  const dom = new JSDOM("<main><button id=outside>Fora</button><section id=gallery></section></main>", { url: "https://example.test" });
  const document = dom.window.document;
  const oldFormData = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;
  const writes = [], changes = [], errors = [];
  const actions = createGalleryRecordActions({
    document, host: document.querySelector("#gallery"),
    loadEditor: async id => context(id),
    saveEditor: async (ctx, fields) => { writes.push(["edit", ctx.item.id, fields]); return { ...ctx.item, fields }; },
    deleteItem: async id => { writes.push(["delete", id]); },
    onChanged: async change => { changes.push(change); },
    onError: error => errors.push(error),
    ...overrides,
  });
  const row = { id: "42", fields: { Title: "Original" } };
  const buttons = actions.render(row);
  document.querySelector("#gallery").append(buttons);
  const get = selector => document.querySelector(selector);
  t.after(() => { actions.destroy(); dom.window.close(); globalThis.FormData = oldFormData; });
  return { dom, document, actions, row, buttons, writes, changes, errors, get };
}
const click = (ctx, action) => ctx.buttons.querySelector(`[data-gallery-action="${action}"]`).click();
const key = (ctx, target, name, options = {}) => target.dispatchEvent(new ctx.dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options }));

test("record buttons have distinct accessible edit/delete icons", async t => {
  const ctx = await setup(t);
  assert.equal(ctx.buttons.className, "gallery-record-actions");
  assert.equal(ctx.get('[data-gallery-action="edit"]').getAttribute("aria-label"), "Editar item de ID 42");
  assert.equal(ctx.get('[data-gallery-action="delete"]').getAttribute("aria-label"), "Deletar item de ID 42");
  assert.equal(ctx.buttons.querySelectorAll('svg[aria-hidden="true"]').length, 2);
});

test("delete requires exact confirmation and Não closes without writes", async t => {
  const ctx = await setup(t);
  const trigger = ctx.get('[data-gallery-action="delete"]');
  trigger.focus(); trigger.click();
  const dialog = ctx.get('[data-gallery-record-dialog]');
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.ok(ctx.get("#gallery").contains(dialog));
  assert.equal(dialog.querySelector("h2").textContent, "Tem certeza que deseja deletar o item de ID 42?");
  assert.deepEqual([...dialog.querySelectorAll("button")].map(b => b.textContent), ["Sim", "Não"]);
  assert.deepEqual(ctx.writes, []);
  dialog.querySelector('[data-gallery-confirm="no"]').click();
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
  assert.equal(ctx.document.activeElement, trigger);
  assert.deepEqual(ctx.writes, []);
});

test("Sim blocks duplicate writes and awaits gallery refresh", async t => {
  const mutation = deferred(), refresh = deferred();
  let writes = 0, changes = 0;
  const ctx = await setup(t, { deleteItem: async () => { writes++; await mutation.promise; }, onChanged: async () => { changes++; await refresh.promise; } });
  click(ctx, "delete");
  const yes = ctx.get('[data-gallery-confirm="yes"]');
  yes.click(); yes.click();
  assert.equal(writes, 1);
  assert.equal(yes.disabled, true);
  assert.equal(ctx.get('[data-gallery-confirm="no"]').disabled, true);
  mutation.resolve(); await settle();
  assert.equal(changes, 1);
  assert.ok(ctx.get('[data-gallery-record-dialog]'));
  refresh.resolve(); await settle();
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
});

test("successful deletion with failed refresh retries only the refresh", async t => {
  let writes = 0, refreshes = 0;
  const ctx = await setup(t, { deleteItem: async () => { writes++; }, onChanged: async () => { if (++refreshes === 1) throw new Error("Falha ao atualizar"); } });
  click(ctx, "delete");
  ctx.get('[data-gallery-confirm="yes"]').click(); await settle();
  assert.equal(writes, 1);
  assert.match(ctx.get('[role="alert"]').textContent, /concluída.*Falha ao atualizar/);
  assert.equal(ctx.get('[data-gallery-confirm="yes"]').disabled, true);
  ctx.get('[data-gallery-refresh-retry]').click(); await settle();
  assert.equal(writes, 1);
  assert.equal(refreshes, 2);
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
});

test("delete errors keep confirmation and record actionable for retry", async t => {
  let attempts = 0;
  const ctx = await setup(t, { deleteItem: async () => { if (++attempts === 1) throw new Error("Sem conexão"); } });
  click(ctx, "delete");
  ctx.get('[data-gallery-confirm="yes"]').click(); await settle();
  assert.match(ctx.get('[role="alert"]').textContent, /Sem conexão/);
  assert.equal(ctx.get('[data-gallery-confirm="yes"]').disabled, false);
  assert.ok(ctx.buttons.isConnected);
  ctx.get('[data-gallery-confirm="yes"]').click(); await settle();
  assert.equal(attempts, 2);
  assert.equal(ctx.changes[0].operation, "delete");
});

test("successful mutation restores focus after reenabling the record action", async t => {
  const ctx = await setup(t);
  const trigger = ctx.get('[data-gallery-action="delete"]');
  trigger.focus(); trigger.click();
  ctx.get('[data-gallery-confirm="yes"]').click(); await settle();
  assert.equal(trigger.disabled, false);
  assert.equal(ctx.document.activeElement, trigger);
});

test("dialog traps Tab and Escape never bubbles to the outer gallery", async t => {
  const ctx = await setup(t);
  let outerKeys = 0;
  ctx.get("#gallery").addEventListener("keydown", () => outerKeys++);
  click(ctx, "delete");
  const yes = ctx.get('[data-gallery-confirm="yes"]'), no = ctx.get('[data-gallery-confirm="no"]');
  no.focus(); key(ctx, no, "Tab");
  assert.equal(ctx.document.activeElement, yes);
  key(ctx, yes, "Tab", { shiftKey: true });
  assert.equal(ctx.document.activeElement, no);
  key(ctx, no, "Escape");
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
  assert.equal(outerKeys, 0);
});

test("closed editor load cannot replace a newer deletion dialog", async t => {
  const loading = deferred();
  const ctx = await setup(t, { loadEditor: () => loading.promise });
  click(ctx, "edit"); ctx.actions.close(); click(ctx, "delete");
  loading.resolve(context("42")); await settle(); await settle();
  assert.equal(ctx.get('[data-gallery-record-dialog] h2').textContent, "Tem certeza que deseja deletar o item de ID 42?");
  assert.equal(ctx.get('[data-dynamic-form]'), null);
});

test("touch cancellation closes editor while metadata is pending and ignores late completion", async t => {
  const loading = deferred();
  const ctx = await setup(t, { loadEditor: () => loading.promise });
  click(ctx, "edit");
  const cancel = ctx.get('[data-gallery-editor-cancel]');
  assert.ok(cancel, "loading editor provides a visible cancel button");
  assert.equal(cancel.textContent, "Cancelar");
  assert.equal(cancel.disabled, false);
  cancel.click();
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
  loading.resolve(context("42")); await settle(); await settle();
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
  assert.equal(ctx.get('[data-dynamic-form]'), null);
  assert.deepEqual(ctx.writes, []);
});

test("forced close keeps mutation latched until settled and suppresses stale refresh", async t => {
  const deleting = deferred();
  const ctx = await setup(t, { deleteItem: () => deleting.promise });
  click(ctx, "delete"); ctx.get('[data-gallery-confirm="yes"]').click(); ctx.actions.close();
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
  assert.equal(ctx.get('[data-gallery-action="delete"]').disabled, true);
  click(ctx, "delete"); assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
  deleting.resolve(); await settle();
  assert.equal(ctx.changes.length, 0);
  assert.equal(ctx.get('[data-gallery-action="delete"]').disabled, false);
});

test("failed metadata load offers retry and never exposes a fake editor", async t => {
  let attempts = 0;
  const ctx = await setup(t, { loadEditor: async id => { if (++attempts === 1) throw new Error("Metadados indisponíveis"); return context(id); } });
  click(ctx, "edit"); await settle();
  assert.match(ctx.get('[role="alert"]').textContent, /Metadados indisponíveis/);
  assert.equal(ctx.get('[data-dynamic-form]'), null);
  ctx.get('[data-gallery-editor-retry]').click(); await settle(); await settle();
  assert.ok(ctx.get('[data-dynamic-form]'));
  assert.equal(ctx.get('[name="Title"]').value, "Original");
});

test("metadata editor retains failed fields and saves through callback", async t => {
  let attempts = 0;
  const ctx = await setup(t, { saveEditor: async (context, fields) => { assert.equal(context.item.id, "42"); assert.equal(fields.Title, "ALTERADO"); if (++attempts === 1) throw new Error("Falha ao salvar"); return { id: "42", fields }; } });
  click(ctx, "edit"); await settle(); await settle();
  ctx.get('[name="Title"]').value = "Alterado";
  const form = ctx.get('[data-dynamic-form]');
  form.dispatchEvent(new ctx.dom.window.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.match(ctx.get('[role="alert"]').textContent, /Falha ao salvar/);
  assert.equal(ctx.get('[name="Title"]').value, "Alterado");
  form.dispatchEvent(new ctx.dom.window.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.equal(ctx.changes[0].operation, "edit");
  assert.equal(ctx.changes[0].item.fields.Title, "ALTERADO");
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
});

test("editor converts ISO dates for native controls while retaining the original record", async t => {
  const original = { Title: "Original", Day: "2026-09-30T03:00:00Z", Time: "2026-09-30T15:30:00Z" };
  const ctx = await setup(t, { loadEditor: async id => ({ ...context(id), item: { id, fields: original }, columns: [
    ...context(id).columns,
    { name: "Day", label: "Data", control: "date", editable: true, hidden: false },
    { name: "Time", label: "Hora", control: "datetime-local", editable: true, hidden: false },
  ] }) });
  click(ctx, "edit"); await settle(); await settle();
  assert.equal(ctx.get('[name="Day"]').value, "2026-09-30");
  assert.equal(ctx.get('[name="Time"]').value, "2026-09-30T15:30");
  assert.equal(original.Day, "2026-09-30T03:00:00Z");
});

test("saved editor locks fields after refresh failure and retries without a second save", async t => {
  let saves = 0, refreshes = 0;
  const ctx = await setup(t, {
    saveEditor: async (context, fields) => { saves++; return { ...context.item, fields }; },
    onChanged: async () => { if (++refreshes === 1) throw new Error("Falha de atualização"); },
  });
  click(ctx, "edit"); await settle(); await settle();
  ctx.get('[data-dynamic-form]').dispatchEvent(new ctx.dom.window.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.equal(ctx.get('[name="Title"]').disabled, true);
  assert.equal(ctx.get('[data-form-save]').disabled, true);
  assert.equal(ctx.get('[data-form-cancel]').disabled, false);
  ctx.get('[data-gallery-refresh-retry]').click(); await settle();
  assert.equal(saves, 1);
  assert.equal(refreshes, 2);
});

test("ambiguous Power Apps forms require a known variant before editing", async t => {
  const loads = [];
  const ctx = await setup(t, { loadEditor: async (id, options) => { loads.push(options); return options?.formVariantId ? context(id) : { ...context(id), contract: { requiresVariantSelection: true, formVariants: [{ id: "form1", label: "Formulário comprovado" }] } }; } });
  click(ctx, "edit"); await settle();
  const select = ctx.get('[data-gallery-form-variant]');
  assert.ok(select); assert.equal(ctx.get('[data-dynamic-form]'), null);
  select.value = "form1"; select.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true })); await settle(); await settle();
  assert.equal(loads.at(-1).formVariantId, "form1");
  assert.ok(ctx.get('[data-dynamic-form]'));
});

test("Power Apps choice keyboard selection stays inside editor and rejects arbitrary text", async t => {
  const ctx = await setup(t, { loadEditor: async id => ({ ...context(id), columns: [{
    name: "Status", label: "Status", control: "select", choices: ["ABERTO", "FECHADO"],
    editable: true, hidden: false, required: true, powerApps: { closed: true },
  }], item: { id, fields: { Status: "ABERTO" } } }) });
  click(ctx, "edit"); await settle(); await settle();
  const input = ctx.get('[role="combobox"]');
  input.value = "Inventado";
  input.dispatchEvent(new ctx.dom.window.Event("input", { bubbles: true }));
  ctx.get('[data-dynamic-form]').dispatchEvent(new ctx.dom.window.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.equal(ctx.writes.length, 0);
  input.value = "FECHADO";
  input.dispatchEvent(new ctx.dom.window.Event("input", { bubbles: true }));
  key(ctx, input, "ArrowDown"); key(ctx, input, "Escape");
  assert.ok(ctx.get('[data-gallery-record-dialog]'), "Escape closes the nested choices first");
  input.value = "FECHADO";
  input.dispatchEvent(new ctx.dom.window.Event("input", { bubbles: true }));
  key(ctx, input, "ArrowDown"); key(ctx, input, "Enter");
  assert.equal(ctx.writes.length, 0, "choice Enter does not submit the form");
  ctx.get('[data-dynamic-form]').dispatchEvent(new ctx.dom.window.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.equal(ctx.writes[0][2].Status, "FECHADO");
});

test("custom editor callback errors are handled without unhandled rejection", async t => {
  const ctx = await setup(t, { onEdit: async row => { assert.equal(row.id, "42"); throw new Error("Erro do editor existente"); }, onError: async () => { throw new Error("Erro ao notificar"); } });
  click(ctx, "edit"); await settle();
  assert.equal(ctx.get('[data-gallery-action="edit"]').disabled, false);
  assert.equal(ctx.get('[data-gallery-record-dialog]'), null);
});
