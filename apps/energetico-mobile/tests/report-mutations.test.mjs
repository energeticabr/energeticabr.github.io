import test from 'node:test';
import assert from 'node:assert/strict';
import { observeReportMutations } from '../src/report-mutations.js';
import { subscribeDataMutations } from '../../../portal/data/data-mutations.js';

test('the observer preserves service methods replaced or added after controller creation', async t => {
  const service = { sendText: async () => 'old' };
  const observed = observeReportMutations(service); let notifications = 0;
  t.after(subscribeDataMutations(() => notifications++));
  service.sendText = async () => 'current';
  service.completeDelegatedTask = async () => 'completed';
  assert.equal(await observed.sendText(), 'current');
  assert.equal(await observed.completeDelegatedTask(), 'completed');
  assert.equal(notifications, 4);
});

test('frozen service reads keep their receiver and cannot emit mutations', async t => {
  let notifications = 0;
  const service = Object.freeze({ getAttachments() { assert.equal(this, service); return []; } });
  t.after(subscribeDataMutations(() => notifications++));
  assert.deepEqual(observeReportMutations(service).getAttachments(), []);
  assert.equal(notifications, 0);
});

test('main menu navigation leaves snapshots valid while workflow commands invalidate conservatively', async t => {
  let notifications = 0;
  t.after(subscribeDataMutations(() => notifications++));
  const service = observeReportMutations({ sendText: async () => ({ status: 'processed', messages: [] }) });
  await service.sendText({ text: '', replyId: 'portal_confirm_main_menu' });
  assert.equal(notifications, 0);
  await service.sendText({ text: '', replyId: 'confirm_payment' });
  assert.equal(notifications, 2);
});
