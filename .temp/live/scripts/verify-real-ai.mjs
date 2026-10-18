// Run only against your local test database, with a configured server-side AI key.
// Creates one test account and one original character. Never prints credentials.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:18780';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local test server');
let token;
async function request(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  assert(response.ok, `${route}: HTTP ${response.status}`);
  return response;
}
const stamp = Date.now();
const registered = await (await request('/api/auth/register', {
  username: `real_ai_${stamp}`, email: `real_ai_${stamp}@example.com`, password: `TestOnly!${stamp}`,
})).json();
token = registered.token;
assert(token, 'Registration must return a token');
const { character } = await (await request('/api/characters', {
  name: '林澈 真实链路测试', tagline: '原创图书馆管理员',
  personality: '一位温和耐心的图书馆管理员，热爱阅读。用简体中文简短回答读者，保持自己的角色，不替读者做决定。',
  background: '这是用户本地研发验收创建的原创测试角色。',
  greeting: '你好，今天想找什么书？', isPublic: false,
})).json();
const conversation = await (await request('/api/conversations', { characterId: character.id })).json();
const id = conversation.conversation?.id || conversation.id;
assert(id, 'Conversation must have an id');
const response = await request(`/api/conversations/${id}/messages`, { content: '请用简体中文推荐一本经典小说，最多两句话。' });
assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
const wire = await response.text();
assert.doesNotMatch(wire, /"demo"\s*:\s*true|"error"\s*:|模拟 AI 回复/);
assert.match(wire, /\[DONE\]/);
const history = await (await request(`/api/conversations/${id}/messages`)).json();
const assistant = history.filter(message => message.role === 'ASSISTANT');
assert.equal(assistant.length, 1);
assert(assistant[0].content.trim().length > 0);
assert.doesNotMatch(assistant[0].content, /模拟 AI 回复/);
const out = path.resolve(process.env.REAL_AI_TEST_OUT || '../../real-ai-result.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({
  passed: true, timestamp: new Date().toISOString(), base,
  checks: ['真实模型 SSE 成功且无模拟标记', '用户与回复均已保存', '作者私有原创测试角色可用'],
  assistantCharacters: assistant[0].content.length,
  usage:(await(await request('/api/ai/usage')).json()).calls[0],
  note: '此记录只证明一次真实服务调用与保存；不评估模型效果、审核、收费或真机 PWA。',
}, null, 2));
console.log('PASS 真实 AI 流式回复与历史保存（无模拟回复）；报告:', out);
