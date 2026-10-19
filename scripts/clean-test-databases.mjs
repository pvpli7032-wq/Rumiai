/**
 * 清理验收脚本遗留的一次性 SQLite 文件。
 *
 * 背景：所有隔离验收脚本都用 `<用途>-<pid>-<毫秒时间戳>.db` 命名一次性库。正常退出时
 * 由 scripts/helpers/create-isolated-db.mjs 的退出钩子回收（见那里的注释），但进程被强杀
 * （任务管理器结束、IDE 中断、超时 SIGKILL）时钩子不执行，文件就留在 prisma/ 下越堆越多。
 * 本脚本负责扫掉这些孤儿。
 *
 * 刻意做保守：
 * - 只认 `-<pid>-<毫秒时间戳>.db` 这个一次性命名模板，连同 -wal / -shm / -journal 邻接文件；
 * - 永远跳过 prisma/.local（本机开发库）、prisma/backups 与 prisma/restores（演练归档）、
 *   prisma/migrations（迁移）；
 * - 60 秒内刚写过的文件不动；名字里的 pid 若仍是活进程也跳过——矩阵的库要跑好几分钟，
 *   只靠修改时间挡不住正在跑的测试；
 * - 不带 --apply 只报告不删除。
 *
 * 用法：
 *   node scripts/clean-test-databases.mjs           # 只列清单
 *   node scripts/clean-test-databases.mjs --apply   # 真删
 */
import {readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';

const root = path.resolve('prisma');
const EPHEMERAL_PATTERN = /-\d+-\d{13}\.db(-wal|-shm|-journal)?$/;
const PROTECTED_DIRECTORIES = ['.local', 'backups', 'restores', 'migrations'];
const MIN_AGE_MS = 60_000;
const apply = process.argv.includes('--apply');

const victims = [];
let skippedRecent = 0;
let skippedLive = 0;

/** 一次性库名里带着创建它的进程 pid；进程还在跑就说明这个库正在被用。 */
function creatorAlive(name) {
  const pid = Number(/-(\d+)-\d{13}\.db/.exec(name)?.[1]);
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scan(directory, depth = 0) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // 受保护目录可能在子层级（如 backups/xxx/database.db），遇到即不再深入。
      if (depth === 0 && PROTECTED_DIRECTORIES.includes(entry.name)) continue;
      continue;
    }
    if (!EPHEMERAL_PATTERN.test(entry.name)) continue;
    const age = Date.now() - statSync(target).mtimeMs;
    if (age < MIN_AGE_MS) { skippedRecent += 1; continue; }
    if (creatorAlive(entry.name)) { skippedLive += 1; continue; }
    victims.push({target, bytes: statSync(target).size});
  }
}

scan(root);

if (!victims.length) {
  console.log(skippedRecent || skippedLive ? `没有可清理的遗留库（${skippedRecent} 个文件不到 60 秒${skippedLive ? `，${skippedLive} 个库的创建进程仍在运行` : ''}，均跳过）。` : '没有发现遗留的一次性库文件。');
  process.exit(0);
}

const total = victims.reduce((sum, item) => sum + item.bytes, 0);
console.log(`${apply ? '删除' : '将要删除'} ${victims.length} 个遗留文件，共 ${(total / 1024 / 1024).toFixed(1)} MB：`);
for (const {target, bytes} of victims.sort((left, right) => right.bytes - left.bytes)) {
  console.log(`  ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${path.relative(process.cwd(), target)}`);
}
if (skippedRecent) console.log(`（另有 ${skippedRecent} 个文件不足 60 秒，疑为正在运行的测试，已跳过。）`);
if (skippedLive) console.log(`（另有 ${skippedLive} 个文件的创建进程仍在运行，不做删除。）`);

if (!apply) {
  console.log('\n这是预览。确认无误后加 --apply 执行删除。');
  process.exit(0);
}

let removed = 0;
for (const {target} of victims) {
  rmSync(target, {force: true});
  removed += 1;
}
console.log(`\n已清理 ${removed} 个文件。`);
