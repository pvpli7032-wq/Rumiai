/**
 * 本机建库：直接用 node:sqlite 按顺序执行迁移文件，并写入 Prisma 期望的
 * `_prisma_migrations` 记录（含校验和），让 `next build` 与启动门禁都能在本机跑通。
 *
 * 具体的数据库构造逻辑抽到 scripts/helpers/create-isolated-db.mjs，
 * 隔离验收脚本可以直接 import，不必各自再 spawn 一次 Prisma CLI。
 *
 * 用法：node scripts/make-local-db.mjs [输出路径]
 * 默认输出 prisma/.local/dev.db，重复运行会重建。
 */
import path from 'node:path';
import {existsSync, statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createIsolatedDatabase} from './helpers/create-isolated-db.mjs';

const target = path.resolve(process.argv[2] ?? 'prisma/.local/dev.db');
// persist: true —— 这个脚本的职责就是「把库建好留在那」：
// 矩阵把它当子进程调用时，若按一次性库回收规则自动删掉，父进程随后就无库可用。
const {migrations: applied} = createIsolatedDatabase(target, {persist: true});

const db = new DatabaseSync(target);
const tables = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'").get().c;
const recorded = db.prepare('SELECT count(*) AS c FROM _prisma_migrations').get().c;
db.close();
console.log(JSON.stringify({database: target, migrations: applied, recorded, tables}));
