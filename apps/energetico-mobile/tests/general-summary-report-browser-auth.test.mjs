import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAuth } from '../src/web/browser-auth.js';

// Break: missing allowlist, cross-account resume, or accepting non-read permissions.
const account = { homeAccountId: 'summary-user', username: 'person@example.invalid' };
const action = 'header-general-summary-report';
const key = 'energetico:msal-pending-action:v1';
const config = { scopes: ['User.Read'], webRedirectUri: 'https://www.energeticabr.com/energetico/' };
function harness(redirect = null, values = new Map()) {
  const requests = [];
  const auth = createBrowserAuth({
    config,
    storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) },
    client: {
      async initialize() {}, async handleRedirectPromise() { return redirect; },
      getAllAccounts() { return [account]; },
      async acquireTokenRedirect(request) { requests.push(request); }, async logoutRedirect() {},
    },
  });
  return { auth, values, requests };
}
test('summary consent persists its own account and read-only redirect action', async () => {
  const h = harness(); await h.auth.initialize();
  await h.auth.authorize(['Sites.Read.All'], { resumeAction: action });
  assert.deepEqual(JSON.parse(h.values.get(key) ?? 'null'), { version: 1, action, accountId: account.homeAccountId, scopes: ['Sites.Read.All'] });
  assert.deepEqual(h.requests, [{ account, scopes: ['Sites.Read.All'], redirectUri: config.webRedirectUri }]);
});
for (const [name, redirect, expected] of [
  ['same account and read scope', { account, accessToken: 'test', scopes: ['Sites.Read.All'] }, action],
  ['case insensitive scope', { account, accessToken: 'test', scopes: ['sites.read.all'] }, action],
  ['different account', { account: { ...account, homeAccountId: 'other' }, accessToken: 'test', scopes: ['Sites.Read.All'] }, null],
  ['missing read scope', { account, accessToken: 'test', scopes: ['User.Read'] }, null],
  ['write scope only', { account, accessToken: 'test', scopes: ['Sites.ReadWrite.All'] }, null],
  ['no access token', { account, scopes: ['Sites.Read.All'] }, null], ['cached account only', null, null],
]) {
  test(`summary redirect accepts only ${name}`, async () => {
    const first = harness(); await first.auth.initialize();
    await first.auth.authorize(['Sites.Read.All'], { resumeAction: action });
    const next = harness(redirect, first.values); await next.auth.initialize();
    assert.equal(next.auth.consumePendingAction(), expected);
    assert.equal(next.auth.consumePendingAction(), null);
    assert.equal(first.values.size, 0);
  });
}
test('summary action cannot resume when its stored scopes contain no Sites.Read.All', async () => {
  const values = new Map([[key, JSON.stringify({ version: 1, action, accountId: account.homeAccountId, scopes: ['User.Read'] })]]);
  const h = harness({ account, accessToken: 'test', scopes: ['User.Read', 'Sites.Read.All'] }, values);
  await h.auth.initialize(); assert.equal(h.auth.consumePendingAction(), null);
});
test('sign-out clears pending summary authorization', async () => {
  const h = harness(); await h.auth.initialize();
  await h.auth.authorize(['Sites.Read.All'], { resumeAction: action }); await h.auth.signOut();
  assert.equal(h.values.size, 0); assert.equal(h.auth.consumePendingAction(), null);
  await assert.rejects(h.auth.authorize(['Sites.Read.All'], { resumeAction: action }), { code: 'AUTH_REQUIRED' });
});
