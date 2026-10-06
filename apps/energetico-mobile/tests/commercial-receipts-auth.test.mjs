import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAuth } from '../src/web/browser-auth.js';

const account = { homeAccountId: 'commercial-user', username: 'person@example.invalid' };
const config = { scopes: ['User.Read'], webRedirectUri: 'https://www.energeticabr.com/energetico/' };
const pendingKey = 'energetico:msal-pending-action:v1';

function harness(redirect = null, values = new Map()) {
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const requests = [];
  const auth = createBrowserAuth({ storage, config, client: {
    async initialize() {},
    async handleRedirectPromise() { return redirect; },
    getAllAccounts() { return [account]; },
    async acquireTokenRedirect(request) { requests.push(request); },
    async logoutRedirect() {},
  } });
  return { auth, values, requests };
}

test('read-only commercial receipts consent persists its own account and redirect action', async () => {
  const h = harness();
  await h.auth.initialize();
  await h.auth.authorize(['Sites.Read.All'], { resumeAction: 'action_commercial_receipts' });
  assert.deepEqual(JSON.parse(h.values.get(pendingKey) ?? 'null'), {
    version: 1, action: 'action_commercial_receipts', accountId: 'commercial-user', scopes: ['Sites.Read.All'],
  });
  assert.deepEqual(h.requests, [{ account, scopes: ['Sites.Read.All'], redirectUri: config.webRedirectUri }]);
});

for (const [name, redirect, expected] of [
  ['matching account and read scopes', { account, accessToken: 'read-token', scopes: ['Sites.Read.All'] }, 'action_commercial_receipts'],
  ['case-insensitive read scopes', { account, accessToken: 'read-token', scopes: ['sites.read.all'] }, 'action_commercial_receipts'],
  ['another account', { account: { ...account, homeAccountId: 'other' }, accessToken: 'token', scopes: ['Sites.Read.All'] }, null],
  ['missing read scope', { account, accessToken: 'token', scopes: ['User.Read'] }, null],
  ['write scope instead of read', { account, accessToken: 'token', scopes: ['Sites.ReadWrite.All'] }, null],
  ['missing token', { account, scopes: ['Sites.Read.All'] }, null],
  ['cached account without redirect', null, null],
]) {
  test(`commercial receipts redirect resumes once only with ${name}`, async () => {
    const first = harness();
    await first.auth.initialize();
    await first.auth.authorize(['Sites.Read.All'], { resumeAction: 'action_commercial_receipts' });
    const second = harness(redirect, first.values);
    await second.auth.initialize();
    assert.equal(second.auth.consumePendingAction(), expected);
    assert.equal(second.auth.consumePendingAction(), null);
    assert.equal(first.values.has(pendingKey), false);
  });
}

test('sign-out removes pending commercial receipts consent before any redirect can resume it', async () => {
  const first = harness();
  await first.auth.initialize();
  await first.auth.authorize(['Sites.Read.All'], { resumeAction: 'action_commercial_receipts' });
  await first.auth.signOut();
  assert.equal(first.values.has(pendingKey), false);
  assert.equal(first.auth.consumePendingAction(), null);
  await assert.rejects(first.auth.authorize(['Sites.Read.All'], { resumeAction: 'action_commercial_receipts' }), { code: 'AUTH_REQUIRED' });
  const second = harness({ account, accessToken: 'late-token', scopes: ['Sites.Read.All'] }, first.values);
  await second.auth.initialize();
  assert.equal(second.auth.consumePendingAction(), null);
});

test('pending commercial receipts action is accepted without allowing an arbitrary mutating reply', async () => {
  const values = new Map([[pendingKey, JSON.stringify({
    version: 1, action: 'action_delete_stage', accountId: 'commercial-user', scopes: ['Sites.Read.All'],
  })]]);
  const h = harness({ account, accessToken: 'token', scopes: ['Sites.Read.All'] }, values);
  await h.auth.initialize();
  assert.equal(h.auth.consumePendingAction(), null);
});
