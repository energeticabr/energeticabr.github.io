import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createPendingProvisionAttachmentsData } from '../src/chat/orders-gallery-data.js';
import { createProvisionDueDateFixture } from './helpers/provision-due-date-fixture.mjs';

// Standalone release tests: no dependency on the HR draft or its test changes.
function makeHarness({ pendingProvisionAttachmentsDataFactory } = {}) {
  let sequence = 0;
  const store = createConversationStore({ randomUUID: () => 'synthetic-' + ++sequence });
  const handlers = new Map(), renders = [];
  const view = {
    renders,
    render(state) { renders.push(state); },
    on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); },
    focusComposer() {},
    destroy() { handlers.clear(); },
  };
  const client = { sendText: async () => ({ status: 'processed', messages: [] }) };
  const auth = {
    initialize: async () => ({ homeAccountId: 'synthetic-account', name: 'Teste' }),
    getToken: async () => 'synthetic-token',
    signOut: async () => {},
  };
  const native = { importSharedItems: async () => [], discardSharedItem: async () => {} };
  const controller = createAppController({ store, view, client, auth, native,
    diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
    pendingProvisionAttachmentsDataFactory,
  });
  return { store, view, client, auth, native, controller };
}

test("pencil uses selected row sourceKind with the real paginated adapter, even when a legacy provider is cached", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T15:00:00Z") });
  const fixture = createProvisionDueDateFixture(), kinds = [];
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async options => {
    kinds.push(options.sourceKind || "legacy");
    return createPendingProvisionAttachmentsData({ ...options, repository: fixture.repository });
  } });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [
    { id: "42", sourceKind: "provision-description", dueDate: "2026-10-12", supplier: "Fornecedor Exemplo", total: "300" },
  ] });
  t.after(() => h.controller.stop()); await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(kinds[0], "legacy", "startup legitimately primes the legacy provider for an untyped snapshot");
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "42" });
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "42", value: "13/10/2026" }), true);
  assert.deepEqual(fixture.writes.map(write => [write.list, write.id]), [["parents", "42"], ["children", "2"], ["children", "3"]]);
  assert.deepEqual(kinds, ["legacy", "provision-description"]);
  assert.equal(fixture.children.find(row => row.id === "42").fields[fixture.childDue], fixture.originalDate);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.find(row => row.id === "42").dueDate, "2026-10-13");
});

for (const failure of ["transport", "readback"]) test("pencil real adapter keeps the editor open until every linked child is verified: " + failure, async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T15:00:00Z") });
  const fixture = createProvisionDueDateFixture();
  if (failure === "transport") fixture.failChild("3"); else fixture.leaveChildUnconfirmed("3");
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async options => createPendingProvisionAttachmentsData({ ...options, repository: fixture.repository }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [
    { id: "42", sourceKind: "provision-description", dueDate: "2026-10-12", supplier: "Fornecedor Exemplo", total: "300" },
  ] });
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "42" });
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "42", value: "13/10/2026" }), false);
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId, "42");
  assert.match(h.view.renders.at(-1).pendingProvisionDateEditError, /sincronização.*não.*concluída[\s\S]*3/i);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.find(row => row.id === "42").dueDate, "2026-10-12");
  fixture.failChild(""); fixture.leaveChildUnconfirmed("");
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "42", value: "13/10/2026" }), true);
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId, "");
  assert.equal(fixture.writes.filter(write => write.list === "parents").length, 1, "retry must preserve the existing parent commit");
  assert.equal(fixture.children.find(row => row.id === "42").fields[fixture.childDue], fixture.originalDate);
});

test("pencil switches the cached provider by explicit row kind within a mixed snapshot", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T15:00:00Z") });
  const kinds = [], writes = [];
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async options => {
    kinds.push(options.sourceKind);
    return { listAttachments: async () => [], downloadAttachment: async () => new Blob(),
      updateDueDate: async (id, date) => writes.push([options.sourceKind, id, date]) };
  } });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, sourceKind: "provision-description", rows: [
    { id: "42", sourceKind: "provision-description", dueDate: "2026-10-12" }, { id: "2", sourceKind: "", dueDate: "12/10/2026" },
  ] });
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "42" });
  await h.view.emit("save-pending-provision-due-date", { paymentId: "42", value: "13/10/2026" });
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "2" });
  await h.view.emit("save-pending-provision-due-date", { paymentId: "2", value: "13/10/2026" });
  assert.deepEqual(writes, [["provision-description", "42", "2026-10-13"], ["", "2", "2026-10-13"]]);
  assert.deepEqual(kinds, ["provision-description", ""]);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.find(row => row.id === "2").dueDate, "13/10/2026");
});

test("pencil rejects an unknown explicit row source instead of guessing from its numeric ID", async t => {
  let writes = 0;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(), updateDueDate: async () => { writes++; },
  }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "42", sourceKind: "unknown-list", dueDate: "2026-10-12" }] });
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "42" });
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "42", value: "13/10/2026" }), false);
  assert.equal(writes, 0);
  assert.match(h.view.renders.at(-1).pendingProvisionDateEditError, /origem/i);
});

test("pencil heals an old child when the parent already has the selected date and row kind overrides a legacy snapshot", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T15:00:00Z") });
  const fixture = createProvisionDueDateFixture();
  // Match the adapter's local-midnight serialization, not the developer's UTC-3.
  const alreadySelectedDate = new Date(2026, 9, 13).toISOString();
  fixture.parent.fields[fixture.parentDue] = alreadySelectedDate;
  fixture.children.find(row => row.id === "2").fields[fixture.childDue] = alreadySelectedDate;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async options =>
    createPendingProvisionAttachmentsData({ ...options, repository: fixture.repository }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, sourceKind: "", rows: [
    { id: "42", sourceKind: "provision-description", dueDate: "2026-10-13", supplier: "Fornecedor Exemplo", total: "300" },
  ] });
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "42" });
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "42", value: "13/10/2026" }), true);
  assert.deepEqual(fixture.writes.map(write => [write.list, write.id]), [["children", "3"]]);
  assert.equal(fixture.children.find(row => row.id === "3").fields[fixture.childDue].slice(0, 10), "2026-10-13");
  assert.equal(fixture.children.find(row => row.id === "42").fields[fixture.childDue], fixture.originalDate);
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId, "");
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.find(row => row.id === "42").dueDate, "2026-10-13");
});
