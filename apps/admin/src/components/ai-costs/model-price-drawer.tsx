'use client';

import {useState, type FormEvent} from 'react';
import {DetailDrawer, DetailRow, DetailSection} from '@admin/components/layout/detail-drawer';
import {AdminNotice} from '@admin/components/admin-page';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {
  NOT_CONFIGURED,
  defaultEffectiveInput,
  formatAmount,
  formatCoins,
  formatDateTime,
  type ModelPriceRow,
} from './types';

/** 一次编辑要提交的两类价格：收费币价（币/条）与供应商成本价（每百万 Token）。 */
export interface PriceDraft {
  coinsPerReply: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  currency: string;
  effectiveAt: string;
  source: string;
  reason: string;
  tiers: PriceTierDraft[];
}

export interface PriceTierDraft {minInputTokens:string;maxInputTokens:string;inputPricePerMillion:string;outputPricePerMillion:string;cachedInputPricePerMillion:string;}

export interface ModelPriceDrawerProps {
  row: ModelPriceRow | null;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (row: ModelPriceRow, draft: PriceDraft) => void;
}

const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

function initialDraft(row: ModelPriceRow): PriceDraft {
  return {
    coinsPerReply: row.coinPrice ? String(row.coinPrice.coinsPerReply) : '',
    inputPricePerMillion: row.costPrice?.inputPricePerMillion ?? '',
    outputPricePerMillion: row.costPrice?.outputPricePerMillion ?? '',
    currency: row.costPrice?.currency ?? 'USD',
    effectiveAt: defaultEffectiveInput(row.costPrice),
    // 回填当前版本的来源：改价时多半只是调数字，来源沿用上一次登记的那句才有意义。
    source: row.costPrice?.source ?? '',
    reason: '',
    tiers: (row.costPrice?.tiers??[]).map(tier=>({minInputTokens:String(tier.minInputTokens),maxInputTokens:tier.maxInputTokens===null?'':String(tier.maxInputTokens),inputPricePerMillion:tier.inputPricePerMillion,outputPricePerMillion:tier.outputPricePerMillion,cachedInputPricePerMillion:tier.cachedInputPricePerMillion??''})),
  };
}

/**
 * 价格编辑抽屉：依次填收费价、供应商成本价、币种和生效时间。
 *
 * 两类价格是两条历史：收费币价追加 ModelCoinPrice 版本，成本价追加 AiModelPrice 版本，
 * 都不会改写已有版本，也不会影响已预扣的费用单。
 */
export function ModelPriceDrawer({row, canManage, busy, onClose, onSubmit}: ModelPriceDrawerProps) {
  const [draft, setDraft] = useState<PriceDraft | null>(row ? initialDraft(row) : null);
  const [error, setError] = useState('');

  const wantsCost = Boolean(draft && (draft.inputPricePerMillion.trim() || draft.outputPricePerMillion.trim()));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !draft) return;
    const coins = draft.coinsPerReply.trim();
    if (!coins) { setError('请填写收费币价；不收费填 0。'); return; }
    if (!/^\d{1,7}$/.test(coins)) { setError('收费币价必须是 0–1000000 的整数。'); return; }
    if (wantsCost) {
      if (!DECIMAL.test(draft.inputPricePerMillion.trim()) || !DECIMAL.test(draft.outputPricePerMillion.trim())) {
        setError('成本价要按「每百万 Token」填数字，最多 6 位小数；不知道就先留空。');
        return;
      }
      if (!/^[A-Z]{3}$/.test(draft.currency)) { setError('成本币种必须是三个大写字母，例如 USD。'); return; }
      if (!draft.source.trim()) { setError('填写成本价时必须写价格来源，方便以后核对。'); return; }
      if (!draft.reason.trim()) { setError('填写成本价时必须写操作理由，会写入管理审计。'); return; }
      if(draft.tiers.some((tier,index)=>!/^\d+$/.test(tier.minInputTokens)||(!tier.maxInputTokens&&index<draft.tiers.length-1)||Boolean(tier.maxInputTokens&&!/^\d+$/.test(tier.maxInputTokens))||!DECIMAL.test(tier.inputPricePerMillion)||!DECIMAL.test(tier.outputPricePerMillion)||Boolean(tier.cachedInputPricePerMillion&&!DECIMAL.test(tier.cachedInputPricePerMillion)))){setError('成本阶梯区间或单价格式无效；最后一档结束值留空表示无上限。');return;}
    }
    if (!draft.effectiveAt) { setError('请选择生效时间。'); return; }
    setError('');
    onSubmit(row, draft);
  }

  return (
    <DetailDrawer
      open={Boolean(row)}
      onClose={onClose}
      title={row ? `编辑价格 · ${row.displayName}` : '编辑价格'}
      description="收费价与成本价分别追加版本；保存后从新请求开始生效，历史账本不变。"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" form="model-price-form" loading={busy} disabled={!canManage}>{busy ? '保存中…' : '保存价格'}</Button>
        </>
      }
    >
      {row && draft && (
        <form id="model-price-form" onSubmit={submit} className="space-y-5">
          <DetailSection title="当前版本" description="只读；历史版本在下方列出，编辑只追加新版本。">
            <div className="space-y-1.5">
              <DetailRow label="收费币价">
                {row.coinPrice ? `${formatCoins(row.coinPrice.coinsPerReply)}/条 · v${row.coinPrice.version} · 生效 ${formatDateTime(row.coinPrice.effectiveAt)}` : NOT_CONFIGURED}
              </DetailRow>
              <DetailRow label="成本价">
                {row.costPrice
                  ? `${row.costPrice.currency} 输入 ${row.costPrice.inputPricePerMillion} / 输出 ${row.costPrice.outputPricePerMillion} · 每百万 Token · 生效 ${formatDateTime(row.costPrice.effectiveAt)}`
                  : NOT_CONFIGURED}
              </DetailRow>
              <DetailRow label="成本价来源">{row.costPrice?.source || NOT_CONFIGURED}</DetailRow>
              {row.costPrice&&<DetailRow label="成本阶梯">{row.costPrice.tiers.length?`${row.costPrice.tiers.length} 档（按输入 Token 区间）`:'未配置，使用单一成本价'}</DetailRow>}
              {row.coinPricePending && <DetailRow label="待生效收费价">v{row.coinPricePending.version} · {formatDateTime(row.coinPricePending.effectiveAt)}</DetailRow>}
              {row.costPricePending && <DetailRow label="待生效成本价">{row.costPricePending.currency} · {formatDateTime(row.costPricePending.effectiveAt)}</DetailRow>}
            </div>
          </DetailSection>

          <DetailSection title="收费币价" description="用户每条回复要付的币数，整数；免费额度适用时本次收费为 0。">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">每条回复币价</span>
              <div className="flex items-center gap-2">
                <Input
                  inputMode="numeric"
                  pattern="\d{1,7}"
                  required
                  value={draft.coinsPerReply}
                  onChange={event => setDraft({...draft, coinsPerReply: event.target.value})}
                  aria-label="每条回复币价"
                />
                <span className="shrink-0 text-sm text-muted-foreground">币/条</span>
              </div>
            </label>
          </DetailSection>

          <DetailSection title="供应商成本价" description="按每百万 Token 记录输入与输出单价；不知道就留空，页面会显示「待配置」而不是按 0 计。">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">输入单价</span>
                <Input inputMode="decimal" value={draft.inputPricePerMillion} onChange={event => setDraft({...draft, inputPricePerMillion: event.target.value})} aria-label="输入单价" placeholder="例如 0.15" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">输出单价</span>
                <Input inputMode="decimal" value={draft.outputPricePerMillion} onChange={event => setDraft({...draft, outputPricePerMillion: event.target.value})} aria-label="输出单价" placeholder="例如 0.6" />
              </label>
            </div>
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">上下文成本阶梯（可选）</p><p className="text-xs text-muted-foreground">按输入 Token 命中 [起始, 结束)；首档从 0 开始、区间连续、末档结束留空。不会改变用户按回复扣币。</p></div><Button type="button" variant="outline" onClick={()=>setDraft({...draft,tiers:[...draft.tiers,{minInputTokens:draft.tiers.at(-1)?.maxInputTokens||'0',maxInputTokens:'',inputPricePerMillion:draft.inputPricePerMillion,outputPricePerMillion:draft.outputPricePerMillion,cachedInputPricePerMillion:''}]})}>添加阶梯</Button></div>
              {draft.tiers.map((tier,index)=><div key={index} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-6">
                <Input aria-label={`阶梯 ${index+1} 起始 Token`} inputMode="numeric" placeholder="起始 Token" value={tier.minInputTokens} onChange={event=>setDraft({...draft,tiers:draft.tiers.map((item,i)=>i===index?{...item,minInputTokens:event.target.value}:item)})}/>
                <Input aria-label={`阶梯 ${index+1} 结束 Token`} inputMode="numeric" placeholder="结束/留空" value={tier.maxInputTokens} onChange={event=>setDraft({...draft,tiers:draft.tiers.map((item,i)=>i===index?{...item,maxInputTokens:event.target.value}:item)})}/>
                <Input aria-label={`阶梯 ${index+1} 输入单价`} inputMode="decimal" placeholder="输入单价" value={tier.inputPricePerMillion} onChange={event=>setDraft({...draft,tiers:draft.tiers.map((item,i)=>i===index?{...item,inputPricePerMillion:event.target.value}:item)})}/>
                <Input aria-label={`阶梯 ${index+1} 输出单价`} inputMode="decimal" placeholder="输出单价" value={tier.outputPricePerMillion} onChange={event=>setDraft({...draft,tiers:draft.tiers.map((item,i)=>i===index?{...item,outputPricePerMillion:event.target.value}:item)})}/>
                <Input aria-label={`阶梯 ${index+1} 缓存输入单价`} inputMode="decimal" placeholder="缓存价/可空" value={tier.cachedInputPricePerMillion} onChange={event=>setDraft({...draft,tiers:draft.tiers.map((item,i)=>i===index?{...item,cachedInputPricePerMillion:event.target.value}:item)})}/>
                <Button type="button" variant="outline" onClick={()=>setDraft({...draft,tiers:draft.tiers.filter((_,i)=>i!==index)})}>移除</Button>
              </div>)}
            </div>
          </DetailSection>

          <DetailSection title="币种与生效时间">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">成本币种</span>
                <Input maxLength={3} className="uppercase" value={draft.currency} onChange={event => setDraft({...draft, currency: event.target.value.toUpperCase()})} aria-label="成本币种" placeholder="USD" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">生效时间（按本机时区）</span>
                <Input type="datetime-local" value={draft.effectiveAt} onChange={event => setDraft({...draft, effectiveAt: event.target.value})} aria-label="生效时间" />
              </label>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">默认立即生效；预约调价把时间往后填即可，已有版本不会被改写。</p>
          </DetailSection>

          <DetailSection title="来源与理由" description="填写成本价时必填：来源写供应商公开价格页或合同版本，理由会写入管理审计。">
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">价格来源</span>
                <Input maxLength={500} value={draft.source} onChange={event => setDraft({...draft, source: event.target.value})} aria-label="价格来源" placeholder="供应商公开价格页或合同版本" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">操作理由</span>
                <Input maxLength={300} value={draft.reason} onChange={event => setDraft({...draft, reason: event.target.value})} aria-label="操作理由" />
              </label>
            </div>
          </DetailSection>

          {row.usage.length > 0 && (
            <DetailSection title="近 7 天用量" description="用于估算平均成本与收入；未知成本单列，不按 0 计。">
              <ul className="space-y-1 text-sm">
                {row.usage.map(item => (
                  <li key={`${item.currency}`} className="break-words text-muted-foreground">
                    {item.currency} · 调用 {item.calls} · 已知成本 {item.knownCostCalls} · 未知成本 {item.unknownCostCalls} · 已知估算 {formatAmount(item.estimatedCost, item.currency)}
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          {!canManage && <AdminNotice tone="info" title="当前账号只能查看价格" description="保存需要「计费管理」权限。" />}
          {error && <AdminNotice tone="error" title={error} />}
        </form>
      )}
    </DetailDrawer>
  );
}
