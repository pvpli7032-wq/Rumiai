import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SITE_URL = 'https://lh.y-98.cn';
const {NextRequest} = await import('next/server');
const {middleware} = await import('../src/middleware.ts');

test('locale redirects preserve the configured public origin behind a local reverse proxy', async () => {
  const root = await middleware(new NextRequest('http://localhost:3000/', {
    headers: {'host': 'localhost:3000', 'x-forwarded-host': 'lh.y-98.cn', 'x-forwarded-proto': 'https'},
  }));
  assert.equal(root.status, 307);
  assert.equal(root.headers.get('location'), 'https://lh.y-98.cn/zh');

  const alias = await middleware(new NextRequest('http://localhost:3000/explore?tag=romance', {
    headers: {'host': 'localhost:3000', 'x-forwarded-host': 'lh.y-98.cn', 'x-forwarded-proto': 'https'},
  }));
  assert.equal(alias.headers.get('location'), 'https://lh.y-98.cn/zh/explore?tag=romance');
});

test('middleware does not redirect API paths to localized HTML pages', async () => {
  const response = await middleware(new NextRequest('http://localhost:3000/api/site', {
    headers: {'host': 'localhost:3000', 'x-forwarded-host': 'lh.y-98.cn', 'x-forwarded-proto': 'https'},
  }));
  assert.equal(response.headers.get('x-middleware-next'), '1');
});
