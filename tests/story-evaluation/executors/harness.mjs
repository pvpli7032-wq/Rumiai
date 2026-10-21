// W08 评测框架 · domain / model-simulated 执行器共用基建。
// 本模块顶层不 import 任何 TypeScript 业务源；只有在执行器真正运行时才动态加载，
// 因此 runner.mjs 在无 tsx 的普通 node 进程里加载本文件是安全的。
//
// 隔离口径：
// - 每个评测进程自建一次性 SQLite（scripts/helpers/create-isolated-db.mjs），
//   不连生产库；沙箱环境跑不了 prisma migrate deploy，沿用 node:sqlite 应用迁移的仓库约定。
// - 路径一律按 import.meta.url 推导仓库根，不依赖 cwd。
// - mock 回合要求 NODE_ENV!=='production' 且 DISABLE_MOCK_AI!=='true'（launch-guards.ts），
//   执行器统一把 DISABLE_MOCK_AI 规整为 'false'（模拟模式口径）。

import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

let environmentPromise = null;

/** 删除隔离库文件（含 WAL/SHM/journal）。评测进程主动清理，避免依赖 exit 钩子。 */
export async function disposeEvaluationEnvironment() {
  if (!environmentPromise) return;
  const env = await environmentPromise;
  environmentPromise = null;
  await env.db.$disconnect().catch(() => {});
  const {rm} = await import('node:fs/promises');
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await rm(env.databasePath + suffix, {force: true, maxRetries: 5, retryDelay: 50}).catch(() => {});
  }
}

/**
 * 初始化一次性隔离库并加载故事链路业务模块。
 * 单例：一个评测进程只建一个库（建库+迁移约数百毫秒），用例间以独立 user/run 隔离。
 */
export function storyEvaluationEnvironment() {
  environmentPromise ??= (async () => {
    const {createIsolatedDatabase} = await import('../../../scripts/helpers/create-isolated-db.mjs');
    const databasePath = path.join(REPO_ROOT, 'prisma', `story-eval-${process.pid}-${Date.now()}.db`);
    // Prisma 期望正斜杠 file: URL；Windows 下反斜杠会导致客户端解析失败。
    process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`;
    process.env.JWT_SECRET ||= randomUUID() + randomUUID();
    // 模拟模式：执行器明确依赖内置 mock 回复（可区分的 demo 标记），关闭真实上游。
    process.env.DISABLE_MOCK_AI = 'false';
    // 清理由 disposeEvaluationEnvironment 主动执行；KEEP_TEST_DB=1 阻止 create-isolated-db
    // 注册 exit 钩子（钩子里的删除在某些宿主环境会被 safe-delete shim 中断并污染输出）。
    const keepDb = process.env.KEEP_TEST_DB === '1';
    process.env.KEEP_TEST_DB = '1';
    const applied = createIsolatedDatabase(databasePath, {migrationsDir: path.join(REPO_ROOT, 'prisma', 'migrations')});
    if (!keepDb) delete process.env.KEEP_TEST_DB;
    const db = (await import('../../../src/lib/db.ts')).db;
    return {
      databasePath,
      migrationsApplied: applied.migrations,
      db,
      modules: {
        turn: await import('../../../src/lib/stories/turn-service.ts'),
        runService: await import('../../../src/lib/stories/repository/run-service.ts'),
        conversations: await import('../../../src/lib/conversations/conversation-service.ts'),
        chatApp: await import('../../../src/lib/conversations/chat-application-service.ts'),
        messages: await import('../../../src/lib/conversations/message-service.ts'),
        // Dependency-inversion wiring: load the story side so it registers its
        // same-transaction invalidation handler with message-service (M4).
        storyInvalidation: await import('../../../src/lib/stories/lifecycle/invalidation.ts'),
      },
    };
  })();
  return environmentPromise;
}

/**
 * 一套最小故事 fixture：owner/stranger + 公开已审核角色 + PUBLISHED 模板与已发布版本。
 * 与 tests/story-run-service.test.mjs 的 fixture 同构，但每次调用生成全新数据，
 * 用例之间通过独立 user 隔离（限流与每日额度都按 user 计）。
 */
export async function createStoryFixture(db, tag) {
  const name = `eval-${tag}-${randomUUID().slice(0, 8)}`;
  const owner = await db.user.create({data: {username: name, email: `${name}@example.invalid`, passwordHash: 'synthetic'}});
  const stranger = await db.user.create({data: {username: `${name}-other`, email: `${name}-other@example.invalid`, passwordHash: 'synthetic'}});
  const character = await db.character.create({data: {creatorId: owner.id, name: '评测角色', personality: 'PRIVATE_PERSONA', background: '', isPublic: true, reviewStatus: 'APPROVED'}});
  const template = await db.storyTemplate.create({data: {slug: name, title: '评测故事', status: 'PUBLISHED'}});
  const definition = {schemaVersion: 1, publicSummary: '公开介绍', chapters: [{key: 'opening', title: '开场'}, {key: 'next', title: '下一章'}], hiddenFacts: 'SECRET_PLOT'};
  const version = await db.storyTemplateVersion.create({data: {templateId: template.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify(definition), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id, prompt: 'PRIVATE_PROMPT'})}});
  const createInput = {templateVersionId: version.id, chapterKey: 'opening', requestId: randomUUID()};
  return {owner, stranger, character, template, version, definition, createInput};
}

/** 与 turn-service.ts 的 requestHash 完全一致，用于手工构造同键回合。 */
export function turnRequestHash(content) {
  return createHash('sha256').update(JSON.stringify({schemaVersion: 1, content})).digest('hex');
}

/** 读取完整 SSE 流并解析 `data: {...}` 事件帧（规划书第 19 章事件流契约）。接受流或流的 Promise。 */
export async function collectStreamEvents(streamSource) {
  const stream = await streamSource;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      }
    }
  }
  return events;
}

/**
 * 断言服务层抛出业务错误并返回 {status, code?, name}；未抛出则失败。
 * 覆盖 StoryError / ChatTurnHttpError / ConversationMessageError 等带 status 的错误类型。
 */
export async function storyRejection(promise, context = '') {
  try {
    await promise;
  } catch (error) {
    if (typeof error?.status === 'number') return {status: error.status, code: error.code, name: error.name, data: error.data};
    throw error;
  }
  throw new Error(`预期业务错误未抛出${context ? `（${context}）` : ''}`);
}

/**
 * 执行一轮回合（mock 上游）并收集事件。expectedRevision 缺省时自动取 run 当前 revision。
 */
export async function runTurn(turnModule, userId, run, content, requestId, expectedRevision) {
  const events = await collectStreamEvents(turnModule.executeStoryTurn({
    userId,
    runId: run.id,
    input: {expectedRevision: expectedRevision ?? run.revision, requestId, content},
    signal: new AbortController().signal,
  }));
  return events;
}
