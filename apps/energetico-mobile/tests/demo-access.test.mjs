import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { randomUUID } from 'node:crypto';
import { createChatClient } from '../src/chat/chat-client.js';

const origin = 'https://163-176-171-217.sslip.io';
const account = { homeAccountId: 'demo:review-session', username: 'revisao@demo.invalid', name: 'Revisão — Demonstração' };
const testPassword = randomUUID();
const sessionResponse = () => ({ accessToken: 'sandbox-token', account, expiresAt: new Date(Date.now() + 600_000).toISOString() });
const processed = { status: 'processed', messages: [{ type: 'text', text: 'Somente dados fictícios' }], attachments: [] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };

test('demo transport confines text, upload and media to sandbox and rejects production media', async () => {
  const requests = [];
  const client = createChatClient({ apiBaseUrl: origin, apiPrefix: '/api/demo', tokenProvider: async () => 'sandbox-token', fetchImpl: async (url, options) => {
    requests.push({ url, options }); return String(url).includes('portal-media') ? new Response('media') : json(processed);
  } });
  await client.sendText({ text: 'oi' });
  await client.sendFile(new File(['abc'], 'review.pdf', { type: 'application/pdf' }));
  await client.fetchMedia({ mediaUrl: '/api/demo/portal-media/file' });
  assert.deepEqual(requests.map(r => new URL(r.url).pathname), ['/api/demo/portal-chat', '/api/demo/portal-upload', '/api/demo/portal-media/file']);
  assert.ok(requests.every(r => r.options.redirect === 'error' && r.options.credentials === 'omit'));
  await assert.rejects(client.fetchMedia({ mediaUrl: '/api/portal-media/corporate' }), /inválido/);
  await assert.rejects(client.fetchMedia({ mediaUrl: 'https://other.test/api/demo/portal-media/file' }), /inválido/);
  assert.equal(requests.length, 3);
  assert.throws(() => createChatClient({ apiBaseUrl: origin, apiPrefix: '/other', tokenProvider: async () => 'x' }), /prefixo/i);
});

test('demo session rejects malformed accounts and expired credentials, revokes without persisting', async () => {
  const { createDemoSession } = await import('../src/demo/demo-session.js');
  const requests = []; let now = Date.now();
  const auth = createDemoSession({ now: () => now, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return options.method === 'DELETE' ? new Response(null, { status: 204 }) : json(sessionResponse());
  } });
  assert.equal(await auth.initialize(), null);
  assert.deepEqual(await auth.signIn({ username: 'review', password: testPassword }), account);
  assert.equal(await auth.getToken(), 'sandbox-token');
  assert.equal(requests[0].url, origin + '/api/demo/session');
  assert.deepEqual(JSON.parse(requests[0].options.body), { username: 'review', password: testPassword });
  now += 700_000;
  await assert.rejects(auth.getToken(), /expirou/i);
  await auth.signOut();
  assert.equal(await auth.initialize(), null);
  assert.equal(requests.at(-1).options.method, 'DELETE');
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer sandbox-token');
  const invalid = createDemoSession({ fetchImpl: async () => json({ ...sessionResponse(), account: { ...account, homeAccountId: 'corporate' } }) });
  await assert.rejects(invalid.signIn({ username: 'review', password: testPassword }), /inválida/i);
  await assert.rejects(invalid.getToken(), /demonstração/i);
});

test('demo native ports and recovery cannot consume corporate share inbox or saved drafts', async () => {
  const { createDemoPorts, createDemoRecovery } = await import('../src/demo/demo-session.js');
  const forbidden = () => { throw new Error('Production inbox accessed'); };
  const selected = new File(['manual'], 'manual.pdf', { type: 'application/pdf' });
  const ports = createDemoPorts({ importSharedItems: forbidden, discardSharedItem: forbidden, pickDocuments: async () => [selected], capturePhoto: async () => [], exportMedia: async () => 'cache' });
  assert.deepEqual(await ports.importSharedItems(), []);
  await ports.discardSharedItem('corporate-file');
  assert.deepEqual(await ports.pickDocuments(), [selected]);
  const a = createDemoRecovery(), b = createDemoRecovery();
  a.schedule(account.homeAccountId, { draft: 'demo draft' }); a.flush();
  assert.equal(a.read(account.homeAccountId).draft, 'demo draft');
  assert.equal(b.read(account.homeAccountId), null);
  a.clear(account.homeAccountId);
  assert.equal(a.read(account.homeAccountId), null);
});

async function bootstrapFixture(t, network, { readInbox, demoAccessEnabled = true } = {}) {
  const { createNativeBootstrap } = await import('../src/demo/native-bootstrap.js');
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://localhost/' });
  const root = dom.window.document.querySelector('#app');
  const requests = []; let inboxReads = 0, msalSignouts = 0, initialized = 0, resume;
  const runtime = createNativeBootstrap({ root, config: { apiBaseUrl: origin, demoAccessEnabled },
    auth: { initialize: async () => { initialized++; return null; }, signIn: async () => null, signOut: async () => { msalSignouts++; }, getToken: async () => { throw new Error('Unexpected Microsoft token'); } },
    native: { onResume: async handler => { resume = handler; return () => { resume = null; }; }, importSharedItems: async () => { inboxReads++; if (readInbox) return readInbox(inboxReads); return [Object.assign(new File(['corporate'], 'corporate.pdf', { type: 'application/pdf' }), { id: 'corporate-file', sourceId: 'corporate-file' })]; }, discardSharedItem: async () => { throw new Error('Unexpected inbox deletion'); }, capturePhoto: async () => [], pickDocuments: async () => [new File(['manual'], 'manual.pdf', { type: 'application/pdf' })] },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return network ? network(url, options) : options.method === 'DELETE' ? new Response(null, { status: 204 }) : json(String(url).endsWith('/session') ? sessionResponse() : processed); },
  });
  await runtime.start();
  t.after(() => { runtime.stop(); dom.window.close(); });
  return { dom, root, runtime, requests, counts: () => ({ inboxReads, msalSignouts, initialized, resume }) };
}

test('accepted release exposes explicit demo while disabled configurations still suppress it', async t => {
  const { APP_CONFIG } = await import('../src/config.js');
  assert.equal(APP_CONFIG.demoAccessEnabled, true);
  const fixture = await bootstrapFixture(t, undefined, { demoAccessEnabled: false });
  assert.equal(fixture.root.querySelector('[data-action="demo-access"]'), null);
  assert.equal(fixture.requests.length, 0);
  assert.match(fixture.root.textContent, /Microsoft/);
});

function submitDemo({ root, dom }) {
  root.querySelector('[name="username"]').value = 'review';
  root.querySelector('[name="password"]').value = testPassword;
  root.querySelector('[data-demo-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

function confirmSignOut(root) {
  root.querySelector('[data-action="sign-out"]').click();
  root.querySelector('[data-action="confirm-sign-out"]').click();
}

function chooseDemoDocument(root) {
  root.querySelector('[data-action="pick-files"]').click();
  root.querySelector('[data-action="pick-document-files"]').click();
}

test('real native login enters isolated chat, manually uploads only selected file and exits without Microsoft signout', async t => {
  const f = await bootstrapFixture(t);
  assert.ok(f.root.querySelector('a[href="https://www.energeticabr.com/energetico-privacidade.html"]'));
  f.root.querySelector('[data-action="demo-access"]').click();
  assert.equal(f.counts().resume, null, 'old controller stopped before credential entry');
  submitDemo(f); await settle();
  assert.match(f.root.querySelector('[data-demo-banner]').textContent, /Demonstração — dados fictícios/);
  assert.match(f.root.querySelector('[role="log"]').textContent, /Somente dados fictícios/);
  assert.equal(f.counts().inboxReads, 1);
  assert.ok(f.requests.every(r => new URL(r.url).pathname.startsWith('/api/demo/')));
  assert.ok(f.requests.every(r => !String(r.options.body).includes('corporate')));
  chooseDemoDocument(f.root); await settle();
  const uploads = f.requests.filter(r => String(r.url).endsWith('portal-upload'));
  assert.equal(uploads.length, 1); assert.equal(uploads[0].options.body.name, 'manual.pdf');
  confirmSignOut(f.root); await settle();
  assert.ok(f.root.querySelector('[data-action="sign-in"]'));
  assert.equal(f.root.querySelector('[data-demo-banner]'), null);
  assert.equal(f.counts().msalSignouts, 0);
  assert.equal(f.counts().initialized, 1, 'return to corporate login does not silently resume cached account');
});

test('bad demo credentials remain in explicit form without Microsoft fallback', async t => {
  const f = await bootstrapFixture(t, async () => json({ error: 'Credenciais inválidas' }, 401));
  f.root.querySelector('[data-action="demo-access"]').click(); submitDemo(f); await settle();
  assert.match(f.root.querySelector('[role="alert"]').textContent, /Credenciais inválidas/);
  assert.equal(f.root.querySelector('[name="password"]').value, '');
  assert.equal(f.root.querySelector('[data-demo-banner]'), null);
  assert.equal(f.requests.length, 1);
});

test('cancelled pending demo login cannot replace corporate login and revokes late token', async t => {
  let resolveLogin;
  const f = await bootstrapFixture(t, (url, options) => options.method === 'DELETE' ? new Response(null, { status: 204 }) : new Promise(resolve => { resolveLogin = resolve; }));
  f.root.querySelector('[data-action="demo-access"]').click(); submitDemo(f);
  f.root.querySelector('[data-demo-back]').click();
  resolveLogin(json(sessionResponse())); await settle();
  assert.ok(f.root.querySelector('[data-action="sign-in"]'));
  assert.equal(f.root.querySelector('[data-demo-banner]'), null);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests.at(-1).options.method, 'DELETE');
});

test('late demo upload confirmation cannot redraw demo over the corporate login after exit', async t => {
  let finishUpload;
  const f = await bootstrapFixture(t, (url, options) => {
    if (String(url).endsWith('portal-upload')) return new Promise(resolve => { finishUpload = resolve; });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : json(String(url).endsWith('/session') ? sessionResponse() : processed);
  });
  f.root.querySelector('[data-action="demo-access"]').click(); submitDemo(f); await settle();
  chooseDemoDocument(f.root); await settle();
  confirmSignOut(f.root); await settle();
  finishUpload(json({ ...processed, messages: [{ type: 'text', text: 'Arquivo recebido com sucesso' }, { type: 'text', text: 'Próxima pergunta' }] }));
  await settle();
  assert.ok(f.root.querySelector('[data-action="sign-in"]'));
  assert.equal(f.root.querySelector('[data-demo-banner]'), null);
});

test('demo never renders server-supplied previews as direct image network requests', async t => {
  const result = { status: 'processed', messages: [{ type: 'image', id: 'photo',
    mediaUrl: '/api/demo/portal-media/photo', previewUrl: 'https://outside.test/tracker.png' }],
    attachments: [{ id: 'attachment', fileName: 'photo.png', mimeType: 'image/png',
      mediaUrl: '/api/demo/portal-media/attachment', previewUrl: '/api/portal-media/corporate' }] };
  const f = await bootstrapFixture(t, (url, options) => {
    if (String(url).includes('/portal-media/')) return new Response(null, { status: 404 });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : json(String(url).endsWith('/session') ? sessionResponse() : result);
  });
  f.root.querySelector('[data-action="demo-access"]').click(); submitDemo(f); await settle();
  const sources = [...f.root.querySelectorAll('img')].map(element => element.getAttribute('src'));
  assert.ok(!sources.includes('https://outside.test/tracker.png'));
  assert.ok(!sources.includes('/api/portal-media/corporate'));
  assert.ok(f.requests.every(request => new URL(request.url).pathname.startsWith('/api/demo/')));
});

test('demo logout revokes immediately even when corporate inbox restoration stalls', async t => {
  let releaseInbox;
  const f = await bootstrapFixture(t, undefined, { readInbox: count => count === 1 ? [] : new Promise(resolve => { releaseInbox = resolve; }) });
  t.after(() => releaseInbox?.([]));
  f.root.querySelector('[data-action="demo-access"]').click(); submitDemo(f); await settle();
  confirmSignOut(f.root); await settle();
  assert.equal(f.counts().inboxReads, 2);
  assert.equal(f.requests.filter(request => request.options.method === 'DELETE').length, 1);
  assert.equal(f.root.querySelector('[data-demo-banner]'), null);
});
