import test from 'node:test';
import assert from 'node:assert/strict';
import {NextResponse} from 'next/server';
import {isAdminOriginAllowed, setAdminSessionCookie} from '../../packages/backend/src/modules/admin-auth/cookies';

const saved = {site: process.env.NEXT_PUBLIC_SITE_URL, admin: process.env.ADMIN_PUBLIC_ORIGIN};
function restore() {
  if (saved.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = saved.site;
  if (saved.admin === undefined) delete process.env.ADMIN_PUBLIC_ORIGIN; else process.env.ADMIN_PUBLIC_ORIGIN = saved.admin;
}

test('admin cookie writes allow configured admin origin and reject an unrelated site', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example.test';
  process.env.ADMIN_PUBLIC_ORIGIN = 'https://admin.example.test';
  try {
    const allowed = new Request('https://api.example.test/api/admin/auth/login', {headers: {origin: 'https://admin.example.test', 'sec-fetch-site': 'same-site'}});
    const rejected = new Request('https://api.example.test/api/admin/auth/login', {headers: {origin: 'https://evil.example.test', 'sec-fetch-site': 'same-site'}});
    const crossSite = new Request('https://api.example.test/api/admin/auth/login', {headers: {origin: 'https://admin.example.test', 'sec-fetch-site': 'cross-site'}});
    assert.equal(isAdminOriginAllowed(allowed), true);
    assert.equal(isAdminOriginAllowed(rejected), false);
    assert.equal(isAdminOriginAllowed(crossSite), false);
  } finally { restore(); }
});

test('cookie secure follows explicit admin HTTPS origin before storefront fallback', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://site.example.test';
  process.env.ADMIN_PUBLIC_ORIGIN = 'https://admin.example.test';
  try {
    const response = setAdminSessionCookie(NextResponse.json({ok: true}), 'a'.repeat(48));
    const header = response.headers.get('set-cookie') ?? '';
    assert.match(header, /Secure/i);
  } finally { restore(); }
});

test('cookie secure falls back to storefront HTTPS when admin origin is absent', () => {
  delete process.env.ADMIN_PUBLIC_ORIGIN;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example.test';
  try {
    const response = setAdminSessionCookie(NextResponse.json({ok: true}), 'b'.repeat(48));
    const header = response.headers.get('set-cookie') ?? '';
    assert.match(header, /Secure/i);
  } finally { restore(); }
});
