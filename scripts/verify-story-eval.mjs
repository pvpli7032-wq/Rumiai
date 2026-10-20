#!/usr/bin/env node
// W08 评测框架运行入口：node scripts/verify-story-eval.mjs <command> [options]
//
// 命令：
//   validate                 校验用例目录结构（默认命令）
//   list                     列出用例
//   report                   输出按验收编号/层级/模型策略的汇总
//   run                      执行用例（domain/model-simulated 已可真实执行；model-output 断言进人工复核队列）
//
// 选项：
//   --acceptance=A05         按验收编号筛选
//   --tier=domain            按验证层级筛选（static|domain|browser|load|model-simulated|model-real|manual）
//   --model=simulated        按模型策略筛选（none|simulated|real）
//   --owner=W08              按负责工作流筛选
//   --id=EV-A05-001          按用例 id 精确筛选
//   --json                   以 JSON 输出（供流水线消费）
//
// 退出码：
//   0 = validate/list/report 成功；run 全部选中用例得到明确结论且无 FAIL/ERROR
//   1 = 目录结构错误或参数错误
//   2 = run 存在 FAIL/ERROR
//   3 = run 无任何用例实际执行（全部 PENDING/BLOCKED）——这不是通过也不是失败
//
// 红线：真实模型用例需要 STORY_EVAL_ALLOW_REAL_MODEL=1 且配置预算才可执行，否则一律 BLOCKED。
// domain / model-simulated 执行器加载 TypeScript 业务源（M3-3 回合服务），run 命令
// 在选中此类用例时自动以 node --import tsx 重启自身（STORY_EVAL_EXECUTOR_CHILD 防递归）。
// 本脚本只读业务源码；测试自建隔离 SQLite，浏览器类执行须使用随机端口，不占用 3000/18782。

import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCases, loadCatalog, filterCases, summarize, RESULT, REGISTERED_TIERS} from '../tests/story-evaluation/runner.mjs';
import {disposeEvaluationEnvironment} from '../tests/story-evaluation/executors/harness.mjs';

function parseArgs(argv) {
  const options = {command: 'validate', filter: {}, json: false};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (!arg.startsWith('--')) {
      if (options.command !== 'validate') throw new Error(`多余的位置参数：${arg}`);
      options.command = arg;
      continue;
    }
    const [key, value] = arg.slice(2).split('=', 2);
    if (value === undefined) throw new Error(`选项 ${key} 需要 =值 形式`);
    switch (key) {
      case 'acceptance': options.filter.acceptance = value; break;
      case 'tier': options.filter.tier = value; break;
      case 'model': options.filter.modelPolicy = value; break;
      case 'owner': options.filter.ownerWorkflow = value; break;
      case 'id': options.filter.id = value; break;
      default: throw new Error(`未知选项 --${key}`);
    }
  }
  return options;
}

function printUsage() {
  console.log('用法: node scripts/verify-story-eval.mjs <validate|list|report|run> [--acceptance=A05] [--tier=domain] [--model=simulated] [--owner=W08] [--id=EV-A05-001] [--json]');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('参数错误：' + error.message);
    printUsage();
    process.exit(1);
  }

  const {cases, errors, total} = loadCatalog();
  if (errors.length) {
    console.error('用例目录存在结构错误：');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  const selected = filterCases(cases, options.filter);
  if (selected.length === 0) {
    console.log('筛选结果为空。');
  }

  if (options.command === 'validate') {
    console.log(`OK：${total} 条用例结构校验通过（含 A01–A13 覆盖检查见 tests/story-evaluation/story-evaluation.test.mjs）。`);
    return;
  }

  if (options.command === 'list') {
    for (const c of selected) {
      console.log(`${c.id}  [${c.acceptance.join(',')}]  tier=${c.verificationTier}  model=${c.modelPolicy}  owner=${c.ownerWorkflow}  status=${c.status}  ${c.title}`);
    }
    console.log(`\n共 ${selected.length}/${total} 条。`);
    return;
  }

  if (options.command === 'report') {
    const s = summarize(selected);
    if (options.json) { console.log(JSON.stringify(s, null, 2)); return; }
    console.log(`用例总数: ${s.total}`);
    console.log('按验收编号:', JSON.stringify(s.byAcceptance));
    console.log('按验证层级:', JSON.stringify(s.byTier));
    console.log('按模型策略:', JSON.stringify(s.byModelPolicy));
    console.log('按负责工作流:', JSON.stringify(s.byOwner));
    console.log('按状态:', JSON.stringify(s.byStatus));
    console.log('\n说明: status=skeleton 表示执行器未实现（记 PENDING）；只有 run 实际执行且断言通过才计 PASS。闭环前不产生正式评分。');
    return;
  }

  if (options.command === 'run') {
    // domain / model-simulated 执行器要动态 import src/ 的 TS 模块（@ 别名由 tsx 解析）。
    // 选中了此类用例且当前进程不是 tsx 子进程时，以 node --import tsx 重启自身。
    const needsExecutor = selected.some(c => c.status === 'implemented' && REGISTERED_TIERS.includes(c.verificationTier));
    if (needsExecutor && process.env.STORY_EVAL_EXECUTOR_CHILD !== '1') {
      const script = fileURLToPath(import.meta.url);
      const child = spawnSync(process.execPath, ['--import', 'tsx', script, ...process.argv.slice(2)], {
        stdio: 'inherit',
        env: {...process.env, STORY_EVAL_EXECUTOR_CHILD: '1'},
      });
      if (child.error) {
        console.error('启动执行器失败（缺少 tsx？）：' + child.error.message);
        console.error('可手动运行：node --import tsx ' + script + ' run ' + process.argv.slice(2).join(' '));
        process.exit(1);
      }
      process.exit(child.status ?? 1);
    }
    const {results, summary, catalogErrors} = await runCases({filter: options.filter});
    if (catalogErrors.length) {
      console.error('目录错误：' + catalogErrors.join(' | '));
      process.exit(1);
    }
    let executed = 0;
    for (const r of results) {
      console.log(`${r.result.padEnd(7)}  ${r.id}  [${r.acceptance.join(',')}]  tier=${r.tier}  model=${r.modelPolicy}${r.reason ? '  ' + r.reason : ''}`);
      if (['PASS', 'FAIL', 'ERROR'].includes(r.result) || (r.result === 'PENDING' && r.review)) executed++;
    }
    const reviewed = results.filter(r => r.review).length;
    if (reviewed) console.log(`\n人工复核队列：${reviewed} 条（model-output 语义断言不自动判分，见 JSON 输出 review 字段）`);
    console.log(`\n选中 ${summary.selected}：PASS=${summary.pass} FAIL=${summary.fail} PENDING=${summary.pending} BLOCKED=${summary.blocked} ERROR=${summary.error}`);
    if (options.json) console.log(JSON.stringify({summary, results}, null, 2));
    if (executed === 0 && summary.pending + summary.blocked > 0) {
      console.log('\n没有任何用例实际执行（执行器未覆盖所选用例）。本结果不是通过，也不是失败。');
      if (!process.env.STORY_EVAL_KEEP_DB) await disposeEvaluationEnvironment();
      process.exit(3);
    }
    if (!process.env.STORY_EVAL_KEEP_DB) await disposeEvaluationEnvironment();
    if (summary.fail + summary.error > 0) process.exit(2);
    return;
  }

  console.error(`未知命令：${options.command}`);
  printUsage();
  process.exit(1);
}

main().catch(async error => { await disposeEvaluationEnvironment().catch(() => {}); console.error(error); process.exit(1); });
