// W08 评测框架 · 用例目录加载与结构校验
// 只读加载 tests/story-evaluation/cases/*.json；不改业务源码。
// 口径：status 仅表示“定义完成度”，不表示通过；只有 runner 实际执行且断言通过才计 PASS。

import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, 'cases');

export const ACCEPTANCE_IDS = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13'];

// 验证层级（规划书第 25 章）：前一层通过不能代替后一层证据。
export const VERIFICATION_TIERS = ['static', 'domain', 'browser', 'load', 'model-simulated', 'model-real', 'manual'];

// modelPolicy 说明本用例对模型调用的要求；none=不调用模型，simulated=模拟上游，real=真实模型（须获授权）。
export const MODEL_POLICIES = ['none', 'simulated', 'real'];

// status 语义：
//   skeleton    用例已定义，执行器尚未实现（报告中记 PENDING，不计通过）
//   implemented 执行器已实现，可被 run 子命令调度
//   verified    最近一次执行通过（由运行结果写入报告，不由本文件静态声明）
export const CASE_STATUSES = ['skeleton', 'implemented', 'verified'];

const REQUIRED_FIELDS = ['id', 'title', 'acceptance', 'verificationTier', 'modelPolicy', 'ownerWorkflow', 'status', 'description', 'steps', 'assertions'];

export function parseCaseFile(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  if (raw.schemaVersion !== 1) throw new Error(`${filePath}: schemaVersion 必须为 1`);
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error(`${filePath}: cases 必须是非空数组`);
  return raw.cases;
}

export function validateCase(c, source) {
  const where = `${source}:${c.id ?? '(无 id)'}`;
  for (const field of REQUIRED_FIELDS) {
    if (c[field] === undefined) throw new Error(`${where}: 缺少必填字段 ${field}`);
  }
  if (!/^EV-A\d{2}-\d{3}$/.test(c.id)) throw new Error(`${where}: id 必须形如 EV-A05-001`);
  if (!Array.isArray(c.acceptance) || c.acceptance.length === 0) throw new Error(`${where}: acceptance 至少一个编号`);
  for (const code of c.acceptance) {
    if (!ACCEPTANCE_IDS.includes(code)) throw new Error(`${where}: 未知验收编号 ${code}`);
  }
  if (!VERIFICATION_TIERS.includes(c.verificationTier)) throw new Error(`${where}: 未知验证层级 ${c.verificationTier}`);
  if (!MODEL_POLICIES.includes(c.modelPolicy)) throw new Error(`${where}: 未知 modelPolicy ${c.modelPolicy}`);
  if (!CASE_STATUSES.includes(c.status)) throw new Error(`${where}: 未知 status ${c.status}`);
  if (!Array.isArray(c.steps) || c.steps.length === 0) throw new Error(`${where}: steps 不能为空`);
  if (!Array.isArray(c.assertions) || c.assertions.length === 0) throw new Error(`${where}: assertions 不能为空`);
  return c;
}

export function loadCatalog({dir = casesDir} = {}) {
  const cases = [];
  const errors = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
      for (const c of parseCaseFile(path.join(dir, file))) cases.push(validateCase(c, file));
    } catch (error) {
      errors.push(error.message);
    }
  }
  const seen = new Map();
  for (const c of cases) {
    if (seen.has(c.id)) errors.push(`重复用例 id: ${c.id}（${seen.get(c.id)}）`);
    seen.set(c.id, 'cases');
  }
  return {cases, errors, total: cases.length};
}

export function filterCases(cases, {acceptance, tier, modelPolicy, ownerWorkflow, id} = {}) {
  return cases.filter(c => {
    if (acceptance && !c.acceptance.includes(acceptance)) return false;
    if (tier && c.verificationTier !== tier) return false;
    if (modelPolicy && c.modelPolicy !== modelPolicy) return false;
    if (ownerWorkflow && c.ownerWorkflow !== ownerWorkflow) return false;
    if (id && c.id !== id) return false;
    return true;
  });
}

export function summarize(cases) {
  const by = key => {
    const map = {};
    for (const c of cases) for (const k of Array.isArray(c[key]) ? c[key] : [c[key]]) map[k] = (map[k] ?? 0) + 1;
    return map;
  };
  return {
    total: cases.length,
    byStatus: by('status'),
    byTier: by('verificationTier'),
    byModelPolicy: by('modelPolicy'),
    byAcceptance: by('acceptance'),
    byOwner: by('ownerWorkflow'),
  };
}
