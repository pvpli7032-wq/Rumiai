// Target a locally running `next start` with no AI key and unsafe demo flags ON.
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18781';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
let token;
async function req(route, body) {
  return fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const stamp = Date.now();
const registration = await req('/api/auth/register', { username: `prod_guard_${stamp}`, email: `prod_guard_${stamp}@example.com`, password: 'Password123!' });
assert.equal(registration.status, 201);
token = (await registration.json()).token;
const before = (await (await req('/api/users/me')).json()).coins;
const packages = await (await req('/api/coins/packages')).json();
assert.equal((await req('/api/coins/purchase', { packageId: packages[0].id })).status, 503);
assert.equal((await (await req('/api/users/me')).json()).coins, before);
console.log('PASS production: simulated purchase blocked, balance unchanged');
const characters = await (await req('/api/characters')).json();
const list = Array.isArray(characters) ? characters : characters.characters;
const { conversation } = await (await req('/api/conversations', { characterId: list[0].id })).json();
assert.equal((await req(`/api/conversations/${conversation.id}/messages`, { content: '不得返回模拟回复' })).status, 503);
assert.equal((await (await req(`/api/conversations/${conversation.id}/messages`)).json()).length, 0);
console.log('PASS production: no AI key returns 503, no messages written');
