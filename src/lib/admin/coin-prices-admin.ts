import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {readSettingValue} from '@/lib/settings';
import {AdminOpsError, idParam} from './ops-error';

/**
 * 模型收费币价（ModelCoinPrice）历史与新增版本。
 *
 * 币价是「按生效时间追加版本」的：新增只插入新行，旧行永远保留，
 * 已经预扣的费用单还带着当时的 price_snapshot_json，改价不影响已开始的请求。
 */

export interface AdminCoinPriceItem {
  id: string;
  modelId: string;
  modelKey: string;
  modelName: string;
  coinsPerReply: number;
  effectiveAt: string;
  version: number;
  createdBy: string;
  createdAt: string;
}

export interface AdminCoinPriceView {
  models: Array<{id: string; key: string; displayName: string}>;
  items: AdminCoinPriceItem[];
  /** 毛利口径由设置中心决定（billing.targetMarginPercent / marginAlertPercent），价格页直接展示。 */
  targetMarginPercent: number;
  marginAlertPercent: number;
}

function toItem(row: {id: string; modelId: string; coinsPerReply: number; effectiveAt: Date; version: number; createdBy: string; createdAt: Date; model: {key: string; displayName: string}}): AdminCoinPriceItem {
  return {
    id: row.id,
    modelId: row.modelId,
    modelKey: row.model.key,
    modelName: row.model.displayName,
    coinsPerReply: row.coinsPerReply,
    effectiveAt: row.effectiveAt.toISOString(),
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

const rowSelect = {
  id: true, modelId: true, coinsPerReply: true, effectiveAt: true, version: true, createdBy: true, createdAt: true,
  model: {select: {key: true, displayName: true}},
} satisfies Prisma.ModelCoinPriceSelect;

export async function readAdminCoinPrices(): Promise<AdminCoinPriceView> {
  await pragmasReady;
  const [models, rows, targetMarginPercent, marginAlertPercent] = await Promise.all([
    db.aiModel.findMany({orderBy: [{sortOrder: 'asc'}, {key: 'asc'}], select: {id: true, key: true, displayName: true}}),
    db.modelCoinPrice.findMany({orderBy: [{modelId: 'asc'}, {effectiveAt: 'desc'}, {id: 'desc'}], take: 200, select: rowSelect}),
    readSettingValue<number>('billing.targetMarginPercent'),
    readSettingValue<number>('billing.marginAlertPercent'),
  ]);
  return {models, items: rows.map(toItem), targetMarginPercent, marginAlertPercent};
}

export interface AdminCoinPriceInput {
  modelId?: unknown;
  coinsPerReply?: unknown;
  effectiveAt?: unknown;
}

/** 新增一个币价版本：旧版本只读保留，同一模型同一生效时间不允许重复。 */
export async function addAdminCoinPrice(input: AdminCoinPriceInput): Promise<AdminCoinPriceItem> {
  await pragmasReady;
  const modelId = typeof input.modelId === 'string' ? idParam(input.modelId) : '';
  if (!modelId) throw new AdminOpsError('请选择要定价的模型。');
  const coins = Number(input.coinsPerReply);
  if (!Number.isSafeInteger(coins) || coins < 0 || coins > 1_000_000) throw new AdminOpsError('收费币价必须是 0–1000000 的整数。');
  let effectiveAt = new Date();
  if (typeof input.effectiveAt === 'string' && input.effectiveAt.trim()) {
    const parsed = new Date(input.effectiveAt);
    if (Number.isNaN(parsed.getTime())) throw new AdminOpsError('生效时间格式不正确。');
    effectiveAt = parsed;
  }
  const model = await db.aiModel.findUnique({where: {id: modelId}, select: {id: true}});
  if (!model) throw new AdminOpsError('这个模型不存在，请刷新后重试。', 404, 'NOT_FOUND');
  const latest = await db.modelCoinPrice.findFirst({where: {modelId}, orderBy: [{version: 'desc'}], select: {version: true}});
  try {
    const saved = await db.modelCoinPrice.create({
      data: {modelId, coinsPerReply: coins, effectiveAt, version: (latest?.version ?? 0) + 1, createdBy: 'admin'},
      select: rowSelect,
    });
    return toItem(saved);
  } catch (error) {
    if ((error as {code?: string}).code === 'P2002') throw new AdminOpsError('这个模型在该生效时间已经有币价版本，请换一个时间。', 409, 'CONFLICT');
    throw error;
  }
}
