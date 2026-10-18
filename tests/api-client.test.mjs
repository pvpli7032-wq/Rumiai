import test from 'node:test';
import assert from 'node:assert/strict';

const {apiFetch, apiBlob, apiRaw, ApiError, api} = await import('../src/lib/api-client.ts');

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply(body, init = {}) {
  return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), init);
}

test('sends the bearer token and JSON content type, and parses the body', async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = {url, init};
    return reply({items: [1, 2]});
  };
  const data = await apiFetch('/api/demo', {method: 'POST', token: 'jwt', body: {a: 1}});
  assert.deepEqual(data, {items: [1, 2]});
  assert.equal(seen.url, '/api/demo');
  assert.equal(seen.init.headers.Authorization, 'Bearer jwt');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.equal(seen.init.body, '{"a":1}');
});

test('keeps FormData raw and does not set a content type', async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = init;
    return reply({ok: true});
  };
  const form = new FormData();
  form.append('file', 'x');
  await apiFetch('/api/upload', {method: 'POST', token: 'jwt', body: form});
  assert.equal(seen.body, form);
  assert.equal(seen.headers['Content-Type'], undefined);
  assert.equal(seen.headers.Authorization, 'Bearer jwt');
});

test('maps a coded error body to ApiError with the same code', async () => {
  globalThis.fetch = async () => reply({error: '请先登录。', code: 'UNAUTHORIZED'}, {status: 401});
  await assert.rejects(apiFetch('/api/admin/access'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.equal(error.message, '请先登录。');
    return true;
  });
});

test('falls back to the status code when a legacy route omits code', async () => {
  globalThis.fetch = async () => reply({error: '角色不存在。'}, {status: 404});
  await assert.rejects(apiFetch('/api/characters/x'), error => {
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, '角色不存在。');
    return true;
  });
});

test('survives an HTML error page without throwing a SyntaxError', async () => {
  globalThis.fetch = async () => reply('<!doctype html><html></html>', {status: 502, headers: {'Content-Type': 'text/html'}});
  await assert.rejects(apiFetch('/api/demo'), error => {
    assert.equal(error.status, 502);
    assert.equal(error.code, 'UPSTREAM_FAILED');
    assert.match(error.message, /502/);
    return true;
  });
});

test('turns a network failure into NETWORK_ERROR but lets AbortError through', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(apiFetch('/api/demo'), {name: 'ApiError', code: 'NETWORK_ERROR'});

  const abort = new DOMException('aborted', 'AbortError');
  globalThis.fetch = async () => {
    throw abort;
  };
  await assert.rejects(apiFetch('/api/demo'), error => error === abort);
});

test('returns undefined for 204 and exposes raw and blob escapes', async () => {
  globalThis.fetch = async () => new Response(null, {status: 204});
  assert.equal(await apiFetch('/api/demo'), undefined);

  const headers = new Headers({'X-Checkout-Enabled': 'false'});
  globalThis.fetch = async () => new Response('{}', {status: 200, headers});
  const raw = await apiRaw('/api/coins/packages');
  assert.equal(raw.headers.get('X-Checkout-Enabled'), 'false');

  globalThis.fetch = async () => new Response('csv,data', {status: 200});
  const blob = await apiBlob('/api/admin/finance/orders/export');
  assert.equal(await blob.text(), 'csv,data');
});

test('api.post passes the method and body through', async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = init;
    return reply({ok: true});
  };
  await api.post('/api/checkin', {mood: 'calm'}, {token: 'jwt'});
  assert.equal(seen.method, 'POST');
  assert.equal(seen.body, '{"mood":"calm"}');
});
