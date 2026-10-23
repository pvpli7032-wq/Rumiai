'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {apiFetch} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';

/**
 * 聊天页的额度与计费状态（V3 表 15 / 表 16）。
 *
 * 数值只有一个来源：GET /api/me/quota。生成过程中服务端会推 cost（预扣）与
 * costResult（结算）两个事件，这里就地更新余额与免费剩余，不整页刷新、不重复拉接口。
 * 取消后服务端不再推事件（连接已断开），由调用方主动 reload 一次。
 */

export type CancelPolicy = 'CHARGE_WHEN_OUTPUT' | 'RELEASE_ALWAYS';

export interface QuotaView {
  balance: number;
  coinsPerReply: number;
  baseCoinsPerReply: number;
  multiplier: number;
  pricing: string;
  freeDaily: number;
  freeUsed: number;
  freeRemaining: number;
  timezone: string;
  resetAt: string;
  /** 取消计费策略；接口尚未返回时按「未知」处理，不提示任何计费结论。 */
  cancelPolicy?: CancelPolicy;
  freeCancelDaily?: number;
  freeCancelRemaining?: number;
}

/** SSE {"cost": ...}：预扣完成（收费时才有）。 */
export interface CostNotice {
  requestId: string;
  charged: boolean;
  coins: number;
  allowanceSource: string;
  balance: number;
}

/** SSE {"costResult": ...}：结算回执。 */
export interface CostReceipt {
  requestId: string;
  chargeId: string;
  status: string;
  coins: number;
  allowanceSource: string;
  balance: number;
}

export interface QuotaState {
  quota: QuotaView | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  applyCost: (event: {cost?: CostNotice; costResult?: CostReceipt}) => void;
}

export function useQuota(token: string | null | undefined): QuotaState {
  const [quota, setQuota] = useState<QuotaView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError('');
    try {
      const view = await apiFetch<QuotaView>(API.me.quota, {token, cache: 'no-store', signal: controller.signal});
      if (!controller.signal.aborted) setQuota(view);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '额度信息读取失败。');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setQuota(null);
    void reload();
    return () => inFlight.current?.abort();
  }, [reload]);

  /**
   * 预扣事件：余额是服务端读到的真实值，直接用；
   * 用掉的是免费次数时本地剩余减一（预占已计入服务端的 freeRemaining）。
   * 结算回执只更新余额：免费次数在预扣时就已经扣过，这里再减会少算。
   */
  const applyCost = useCallback((event: {cost?: CostNotice; costResult?: CostReceipt}) => {
    const notice = event.cost;
    const receipt = event.costResult;
    if (!notice && !receipt) return;
    setQuota(current => {
      if (!current) return current;
      const next = {...current};
      if (notice && Number.isFinite(notice.balance)) next.balance = notice.balance;
      if (receipt && Number.isFinite(receipt.balance)) next.balance = receipt.balance;
      if (notice?.allowanceSource === 'FREE_QUOTA') {
        next.freeRemaining = Math.max(0, current.freeRemaining - 1);
        next.freeUsed = current.freeUsed + 1;
      }
      return next;
    });
  }, []);

  return {quota, loading, error, reload, applyCost};
}
