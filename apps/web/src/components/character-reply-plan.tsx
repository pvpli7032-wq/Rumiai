'use client';

import {useEffect, useState} from 'react';
import {apiFetch} from '@web/lib/api-client';
import type {ReplyPlan} from '@rumiai/contracts/billing/reply-plan';

/**
 * 角色详情的「可用模型与费用」（V3 表 15）。
 *
 * 页面是构建期预渲染的，币价和收费开关却随时在后台改，所以这一块挂载后再读
 * GET /api/characters/reply-plan，由服务端按 quoteReplyPrice 现算。页面自己不做
 * 乘倍率、不猜默认价，错了也不会和聊天页显示的金额对不上。
 * 收费关闭时不写「0 币」，直接说当前免费；读不到就说读不到，并用 CTA 兜住开始对话。
 * compact 用在详情弹窗的「关于」页里：那边已经有卡片外壳，只出内容不再套一层边框。
 */
export function CharacterReplyPlan({characterId, compact = false}: {characterId: string; compact?: boolean}) {
  const [plan, setPlan] = useState<ReplyPlan | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<ReplyPlan>(`/api/characters/reply-plan?characterId=${encodeURIComponent(characterId)}`, {signal: controller.signal, cache: 'no-store'})
      .then(next => { if (!controller.signal.aborted) setPlan(next); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : '费用读取失败。');
      });
    return () => controller.abort();
  }, [characterId]);

  const shell = compact ? '' : 'mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left';
  const title = compact ? 'mb-2 text-xs font-bold text-zinc-500' : 'text-xs font-medium text-zinc-400';

  if (error) {
    return <p className={`${compact ? '' : 'mt-4 '}text-xs text-zinc-500`}>可用模型与费用暂时读不到（{error}）。开始对话后，输入区上方仍会显示实时余额与每条费用。</p>;
  }

  if (!plan) {
    return <p className={`${compact ? '' : 'mt-4 '}text-xs text-zinc-500`} role="status">正在读取可用模型与费用…</p>;
  }

  if (plan.models.length === 0) {
    return <p className={`${compact ? '' : 'mt-4 '}text-xs text-amber-300/90`}>这个角色当前没有可用模型，暂时无法开始对话。可以先去发现页看看其它角色。</p>;
  }

  return (
    <div className={shell}>
      <p className={title}>可用模型与费用</p>
      <ul className="space-y-1.5">
        {plan.models.map(item => (
          <li key={item.modelKey} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="text-zinc-200">
              {item.displayName}
              {item.modelKey === plan.defaultModelKey && <span className="ml-1.5 text-[11px] text-zinc-500">默认</span>}
            </span>
            <span className={item.pricing === 'CHARGED' ? 'text-white' : 'text-emerald-300'}>
              {describePrice(item, plan)}
            </span>
          </li>
        ))}
      </ul>
      {plan.defaultLine && (
        <p className="mt-2 text-xs text-zinc-500">
          {plan.chargingEnabled && plan.models.some(item => item.pricing === 'NO_PRICE')
            ? '收费已开启，但未完成定价的模型暂不可用；系统不会把配置缺失当作免费。'
            : plan.chargingEnabled
            ? '按条计费：每次生成一条回复扣一次，取消按当前取消策略处理。登录后还能看到每日免费条数与余额。'
            : '当前未开启按条收费，可以免费开始。登录后仍能看到每日请求上限。'}
        </p>
      )}
    </div>
  );
}

/** 一句价：收费中写金额，明确免费写免费，缺价格写不可用。 */
function describePrice(item: ReplyPlan['models'][number], plan: ReplyPlan): string {
  if (!plan.chargingEnabled) return '当前免费';
  if (item.pricing === 'NO_PRICE') return '暂不可用（未配置价格）';
  if (item.pricing === 'FREE_MULTIPLIER') return '当前免费';
  return `每条 ${item.coins} 币`;
}
