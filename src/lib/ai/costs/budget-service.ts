import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {readAiCostReport,readAiModelCostReport} from '@/lib/ai/cost-report';
import {readDailyBudgetReport} from '@/lib/ai/budget-report';
import {readTaskBudgetReport} from '@/lib/ai/task-budget';
import {readAiModelPriceCoverage} from './model-price-service';
import {readAiDailyBudgetConfiguration} from './budget-config-service';

type CostPermission = 'ai.costs.read' | 'ai.costs.manage';

export class AiCostManagementError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'AiCostManagementError';
  }
}

async function requirePermission(
  actor: string,
  permission: CostPermission,
  tx?: Parameters<typeof hasAdminPermission>[2],
) {
  if (!await hasAdminPermission(actor, permission, tx)) {
    throw new AiCostManagementError('当前账号没有 AI 成本管理权限。', 403);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiCostManagementError('AI 成本配置格式无效。');
  }
  return value as Record<string, unknown>;
}

function reason(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) {
    throw new AiCostManagementError('请填写 1–300 字操作理由。');
  }
  return value.trim();
}

function amount(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const valid = typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && value <= 1_000_000_000_000
    && Math.round(value * 1_000_000) === value * 1_000_000;
  if (!valid) {
    throw new AiCostManagementError(`${label}必须为大于0且最多6位小数的金额。`);
  }
  return value as number;
}

function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AiCostManagementError('配置版本无效。');
  }
  return value as number;
}

export async function readAiCostDashboard(actor: string, days = 7) {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new AiCostManagementError('统计天数必须为 1–90 的整数。');
  }
  await requirePermission(actor, 'ai.costs.read');
  await pragmasReady;

  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - days * 86400000);
  return db.$transaction(async tx => {
    await requirePermission(actor, 'ai.costs.read', tx);
    const [costs, modelCosts, budget, settings, taskBudgets] = await Promise.all([
      readAiCostReport(tx, since, generatedAt),
      readAiModelCostReport(tx,since,generatedAt),
      readDailyBudgetReport(tx, generatedAt),
      readAiDailyBudgetConfiguration(tx),
      readTaskBudgetReport(tx, generatedAt),
    ]);
    const visibleAlerts = 'alerts' in budget
      ? budget.alerts.map(({scope, currency, knownCost, budget}) => ({scope, currency, knownCost, budget}))
      : [];
    return {
      generatedAt: generatedAt.toISOString(),
      since: since.toISOString(),
      days,
      costs,
      modelCosts,
      budget: {...budget, alerts: visibleAlerts},
      settings,
      taskBudgets,
    };
  });
}

type DailyBudgetInput = {
  currency?: unknown;
  siteLimit?: unknown;
  userLimit?: unknown;
  isActive?: unknown;
  version?: unknown;
  reason?: unknown;
};

export async function saveAiDailyCostBudget(actor: string, input: unknown) {
  const row = object(input);
  const allowed = new Set(['currency', 'siteLimit', 'userLimit', 'isActive', 'version', 'reason']);
  if (Object.keys(row).some(key => !allowed.has(key))) {
    throw new AiCostManagementError('预算配置字段与表单不匹配。');
  }

  const value = row as DailyBudgetInput;
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) {
    throw new AiCostManagementError('币种必须为三个大写字母。');
  }
  if (typeof value.isActive !== 'boolean') {
    throw new AiCostManagementError('启用状态无效。');
  }

  const currency = value.currency;
  const siteLimit = amount(value.siteLimit, '全站日预算');
  const userLimit = amount(value.userLimit, '单用户日预算');
  if (siteLimit === null && userLimit === null) {
    throw new AiCostManagementError('至少填写全站或单用户日预算。');
  }

  const explanation = reason(value.reason);
  const expectedVersion = value.version === undefined ? 0 : version(value.version);
  await requirePermission(actor, 'ai.costs.manage');
  await pragmasReady;

  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actor}`;
      await requirePermission(actor, 'ai.costs.manage', tx);
      const before = await tx.aiDailyCostBudget.findUnique({where: {currency}});
      if ((before?.version ?? 0) !== expectedVersion) {
        throw new AiCostManagementError('该币种预算已变化，请刷新后重试。', 409);
      }

      const isActive = value.isActive as boolean;
      const saved = before
        ? await tx.aiDailyCostBudget.update({
            where: {currency},
            data: {siteLimit, userLimit, isActive, version: {increment: 1}, updatedBy: actor},
          })
        : await tx.aiDailyCostBudget.create({
            data: {currency, siteLimit, userLimit, isActive, version: 1, updatedBy: actor},
          });

      await recordAdminAudit(
        tx,
        actor,
        before ? 'UPDATE_AI_COST_BUDGET' : 'CREATE_AI_COST_BUDGET',
        currency,
        explanation,
        {
          before: before
            ? {
                siteLimit: before.siteLimit,
                userLimit: before.userLimit,
                isActive: before.isActive,
                version: before.version,
              }
            : null,
          after: {siteLimit, userLimit, isActive, version: saved.version},
        },
      );

      return {
        currency: saved.currency,
        siteLimit: saved.siteLimit,
        userLimit: saved.userLimit,
        isActive: saved.isActive,
        version: saved.version,
        updatedAt: saved.updatedAt,
      };
    });
  } catch (error) {
    if (error instanceof AiCostManagementError) throw error;
    if ((error as {code?: string})?.code === 'P2002') {
      throw new AiCostManagementError('该币种预算刚刚被其他管理员创建，请刷新后编辑。', 409);
    }
    throw error;
  }
}

type CircuitBreakerInput = {
  enabled?: unknown;
  version?: unknown;
  reason?: unknown;
};

export async function saveAiCostCircuitBreaker(actor: string, input: unknown) {
  const row = object(input);
  const allowed = new Set(['enabled', 'version', 'reason']);
  if (Object.keys(row).some(key => !allowed.has(key))) {
    throw new AiCostManagementError('熔断策略字段与表单不匹配。');
  }

  const value = row as CircuitBreakerInput;
  if (typeof value.enabled !== 'boolean') {
    throw new AiCostManagementError('熔断启用状态无效。');
  }
  const enabled = value.enabled;
  const expectedVersion = value.version === undefined ? 0 : version(value.version);
  const explanation = reason(value.reason);
  await requirePermission(actor, 'ai.costs.manage');
  await pragmasReady;

  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actor}`;
    await requirePermission(actor, 'ai.costs.manage', tx);
    const before = await tx.aiCostPolicy.findUnique({where: {id: 'GLOBAL'}});
    if ((before?.version ?? 0) !== expectedVersion) {
      throw new AiCostManagementError('熔断策略已变化，请刷新后重试。', 409);
    }

    if (enabled) {
      const configuration = await readAiDailyBudgetConfiguration(tx);
      const coverage=await readAiModelPriceCoverage(tx,new Date());
      const requiredCurrencies=coverage.currencies.length?coverage.currencies:[process.env.AI_PRICE_CURRENCY?.trim()||'USD'];
      if (
        configuration.status !== 'enabled'
        || !configuration.budgets
        || !coverage.configured
        || !coverage.complete
        || requiredCurrencies.some(currency=>!configuration.budgets?.[currency])
      ) {
        throw new AiCostManagementError('启用预算熔断前，需为全部可用 AI 模型配置生效价格，并为每种计价币种配置有效日预算。', 409);
      }
    }

    const saved = before
      ? await tx.aiCostPolicy.update({
          where: {id: 'GLOBAL'},
          data: {circuitBreakerEnabled: enabled, version: {increment: 1}, updatedBy: actor},
        })
      : await tx.aiCostPolicy.create({
          data: {id: 'GLOBAL', circuitBreakerEnabled: enabled, version: 1, updatedBy: actor},
        });

    await recordAdminAudit(
      tx,
      actor,
      before ? 'UPDATE_AI_COST_POLICY' : 'CREATE_AI_COST_POLICY',
      'GLOBAL',
      explanation,
      {
        before: before
          ? {circuitBreakerEnabled: before.circuitBreakerEnabled, version: before.version}
          : null,
        after: {circuitBreakerEnabled: saved.circuitBreakerEnabled, version: saved.version},
      },
    );

    return {
      enabled: saved.circuitBreakerEnabled,
      version: saved.version,
      updatedAt: saved.updatedAt,
    };
  });
}

