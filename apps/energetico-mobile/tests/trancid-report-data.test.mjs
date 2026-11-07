import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './fixtures/trancid-report.mjs';

const module = await import('../src/chat/trancid-report-data.js').catch(() => ({}));
const host = 'energeticaltda-my.sharepoint.com';
const sitePath = '/personal/bernardonotini_energeticabr_com';
const siteId = `${host},00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002`;
const downloadUrl = `https://${host}${sitePath}/_layouts/15/download.aspx?UniqueId=fictitious`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const create = options => {
  assert.equal(typeof module.createTrancidReportData, 'function', 'Authenticated Trancid reader must exist');
  return module.createTrancidReportData(options);
};
const response = (body, status = 200, extra = {}) => ({ ok: status >= 200 && status < 300, status,
  json: async () => body, ...extra });

function fixture(overrides = {}) {
  const calls = [], scopes = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === downloadUrl) return response(overrides.body ?? snapshot(), overrides.contentStatus ?? 200,
      { url: downloadUrl, ...overrides.content });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://graph.microsoft.com');
    if (parsed.pathname.includes('/drive/root:')) return response({ id: 'item-1', name: 'report_snapshot.json',
      size: 1024, file: { mimeType: 'application/json' }, '@microsoft.graph.downloadUrl': downloadUrl,
      ...overrides.metadata }, overrides.graphStatus ?? 200);
    return response({ id: siteId }, overrides.graphStatus ?? 200);
  };
  const tokenProvider = async (requestedScopes, options) => {
    scopes.push({ requestedScopes, options }); return 'fictitious-ms-token';
  };
  return { calls, scopes, fetchImpl, tokenProvider };
}

test('authenticated reader locates the private Documents snapshot and sends bearer only to Microsoft Graph', async () => {
  const f = fixture(), data = create(f);
  const loaded = await data.loadSnapshot();
  assert.equal(loaded.schema_version, 1); assert.equal(loaded.runs.length, 1);
  assert.equal(typeof loaded.runs[0].snapshot, 'string');
  assert.ok(Object.isFrozen(loaded)); assert.ok(Object.isFrozen(loaded.runs)); assert.ok(Object.isFrozen(loaded.runs[0]));
  assert.equal(f.calls.length, 3);
  assert.equal(new URL(f.calls[0].url).pathname, `/v1.0/sites/${host}:${sitePath}`);
  assert.equal(decodeURIComponent(new URL(f.calls[1].url).pathname), `/v1.0/sites/${siteId}/drive/root:/TRANCID/report_snapshot.json`);
  for (const { url, options } of f.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    assert.equal(options.headers.Authorization, new URL(url).hostname === 'graph.microsoft.com' ? 'Bearer fictitious-ms-token' : undefined);
  }
  assert.deepEqual(f.scopes.map(item => item.requestedScopes), [['Sites.Read.All'], ['Sites.Read.All']]);
  assert.ok(f.scopes.every(item => item.options.signal));
  assert.equal(JSON.stringify(loaded).includes('UniqueId'), false, 'temporary download capability never escapes the reader');
});

test('missing Microsoft session and bad tokens fail before any SharePoint read', async () => {
  assert.throws(() => create(), TypeError);
  for (const token of [null, undefined, '', ' ', { accessToken: 'bad-shape' }]) {
    const f = fixture();
    await assert.rejects(create({ ...f, tokenProvider: async () => token }).loadSnapshot(),
      error => error.status === 401 && error.code === 'token_unavailable');
    assert.equal(f.calls.length, 0);
  }
});

test('Microsoft authentication and authorization failures propagate without a fallback or anonymous retry', async () => {
  for (const status of [401, 403]) {
    const f = fixture({ graphStatus: status });
    await assert.rejects(create(f).loadSnapshot(), error => error.status === status);
    assert.equal(f.calls.length, 1);
  }
  const failure = new Error('Conta Microsoft mudou');
  const f = fixture();
  await assert.rejects(create({ ...f, tokenProvider: async () => { throw failure; } }).loadSnapshot(), error => error === failure);
  assert.equal(f.calls.length, 0);
});

test('temporary file URLs must stay on the configured private SharePoint site and are never followed through redirects', async () => {
  for (const url of ['https://example.com/private.json', `http://${host}${sitePath}/download`,
    `https://${host}.example.com${sitePath}/download`, `https://user:password@${host}${sitePath}/download`,
    `https://${host}:444${sitePath}/download`, `https://${host}/personal/outro_usuario/download`,
    `https://${host}${sitePath}/download#fragment`, '/relative/download']) {
    const f = fixture({ metadata: { '@microsoft.graph.downloadUrl': url } });
    await assert.rejects(create(f).loadSnapshot(), TypeError);
    assert.equal(f.calls.length, 2);
  }
  for (const content of [{ redirected: true }, { url: 'https://example.com/private.json' }]) {
    await assert.rejects(create(fixture({ content })).loadSnapshot(), TypeError);
  }
});

test('invalid file metadata, download authorization and incomplete snapshot bodies never become reports', async () => {
  for (const metadata of [{ name: 'another.json' }, { file: null }, { size: 0 }, { '@microsoft.graph.downloadUrl': null }]) {
    const f = fixture({ metadata });
    await assert.rejects(create(f).loadSnapshot(), TypeError); assert.equal(f.calls.length, 2);
  }
  for (const status of [401, 403, 404]) {
    await assert.rejects(create(fixture({ contentStatus: status })).loadSnapshot(), error => error.status === status);
  }
  await assert.rejects(create(fixture({ body: { ...snapshot(), runs: [] } })).loadSnapshot(), TypeError);
  await assert.rejects(create(fixture({ content: { json: async () => { throw new SyntaxError('bad json'); } } })).loadSnapshot(), TypeError);
});

test('caller cancellation stops waiting for a token and consumes its late result without making a request', async () => {
  const entered = deferred(), token = deferred(), controller = new AbortController(), f = fixture();
  const result = create({ ...f, tokenProvider: async () => { entered.resolve(); return token.promise; } })
    .loadSnapshot({ signal: controller.signal });
  const rejection = assert.rejects(result, { name: 'AbortError' });
  await entered.promise; controller.abort(); await rejection;
  token.resolve('late-token'); await new Promise(done => setImmediate(done));
  assert.equal(f.calls.length, 0);
});

test('pre-aborted loads do no work and cancellation also covers content JSON parsing', async () => {
  const f = fixture(), pre = new AbortController(); pre.abort();
  await assert.rejects(create(f).loadSnapshot({ signal: pre.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 0); assert.equal(f.scopes.length, 0);
  const entered = deferred(), pending = deferred(), controller = new AbortController();
  const data = create(fixture({ content: { json: async () => { entered.resolve(); return pending.promise; } } }));
  const result = data.loadSnapshot({ signal: controller.signal });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await entered.promise; controller.abort(); await rejected;
  pending.resolve(snapshot()); await new Promise(done => setImmediate(done));
});

test('a replacement load cancels an old account request even if fetch ignores the signal', async () => {
  const f = fixture(), entered = deferred(), pending = deferred(); let count = 0;
  const data = create({ ...f, fetchImpl: async (url, options) => {
    if (++count === 1) { entered.resolve(); await pending.promise; }
    return f.fetchImpl(url, options);
  } });
  const first = data.loadSnapshot(), rejection = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  const second = await data.loadSnapshot();
  await rejection; assert.equal(second.runs.length, 1);
  pending.resolve(); await new Promise(done => setImmediate(done));
  assert.equal(f.calls.filter(item => item.url === downloadUrl).length, 1);
});
