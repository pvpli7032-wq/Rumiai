'use client';

import {useCallback, useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {Coins, Database, ShieldOff, Tag} from 'lucide-react';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Select} from '@/components/ui/select';

type BudgetRow={
  currency:string;siteLimit:number|null;userLimit:number|null;isActive:boolean;version:number;updatedAt:string;
};
type Dashboard={
  generatedAt:string;
  since:string;
  days:number;
  costs:Array<{currency:string;calls:number;realCalls:number;knownCostCalls:number;unknownCostCalls:number;estimatedCost:number;failedCalls:number;mockCalls:number;costPerThousandCalls:number|null}>;
  modelCosts:Array<{modelId:string|null;modelKey:string|null;displayName:string;providerName:string|null;providerModelCode:string|null;currency:string;calls:number;knownCostCalls:number;unknownCostCalls:number;estimatedCost:number;failedCalls:number}>;
  budget:{status:'enabled'|'disabled'|'invalid';source:string;circuitBreaker:string;pricingConfigured:boolean;pricingUnpricedModels:string[];unknownCostCalls:number;alerts:Array<{scope:'site'|'user';currency:string;knownCost:number;budget:number}>};
  settings:{source:string;status:'enabled'|'disabled'|'invalid';circuitBreaker:'enabled'|'disabled'|'invalid';circuitBreakerVersion:number;rows:BudgetRow[]};
};
type Draft={currency:string;siteLimit:string;userLimit:string;isActive:boolean;version:number;reason:string;isExisting:boolean};

const emptyDraft=(row?:BudgetRow):Draft=>({
  currency:row?.currency??'USD',
  siteLimit:row?.siteLimit===null||row?.siteLimit===undefined?'':String(row.siteLimit),
  userLimit:row?.userLimit===null||row?.userLimit===undefined?'':String(row.userLimit),
  isActive:row?.isActive??true,
  version:row?.version??0,
  reason:'',
  isExisting:Boolean(row),
});
function formatAmount(amount:number,currency:string){
  try{return new Intl.NumberFormat('zh-CN',{style:'currency',currency,maximumFractionDigits:6}).format(amount);}
  catch{return `${amount.toFixed(6)} ${currency}`;}
}

/** 成本与预算总览。额外面板通过 children 挂在同一张页面里，避免多套版式并列。 */
export function AiCostManagement({children}: {children?: ReactNode}){
  const {token,permissions,loading}=useAdminAccess();
  const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [days,setDays]=useState(7);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const canManage=permissions.includes('ai.costs.manage');

  const load=useCallback(async()=>{
    if(!token)return;
    const response=await fetch(`/api/admin/ai/costs?days=${days}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error);
    setDashboard(data);
  },[token,days]);

  useEffect(()=>{
    let active=true;
    setDashboard(null);setError('');
    if(token)void load().catch(loadError=>{if(active)setError(loadError.message);});
    return()=>{active=false;};
  },[token,load]);

  async function post(type:'budget'|'circuit-breaker',value:unknown){
    if(!token)return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/admin/ai/costs',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({type,value})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      setNotice(type==='budget'?'日预算已保存并写入操作审计。':'预算熔断策略已保存并写入操作审计。');
      setDraft(null);
      await load();
    }catch(saveError){setError(saveError instanceof Error?saveError.message:'保存失败。');try{await load();}catch{}}
    finally{setBusy(false);}
  }

  function submitBudget(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!draft)return;
    void post('budget',{
      currency:draft.currency.trim().toUpperCase(),
      siteLimit:draft.siteLimit===''?null:Number(draft.siteLimit),
      userLimit:draft.userLimit===''?null:Number(draft.userLimit),
      isActive:draft.isActive,
      version:draft.version,
      reason:draft.reason,
    });
  }

  if(loading)return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  if(!token||!permissions.includes('ai.costs.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有 AI 成本查看权限。" /></AdminPage>;

  return <AdminPage>
    <AdminPageHeader
      eyebrow="AI 与成本"
      title="成本与预算"
      description="按币种分别统计估算；未知成本不视为零，报告不等同于供应商账单。"
      actions={
        <>
          <div className="w-32">
            <Select aria-label="统计范围" value={days} onChange={event=>setDays(Number(event.target.value))}>
              {[1,7,30,90].map(value=><option key={value} value={value}>近 {value} 天</option>)}
            </Select>
          </div>
          <Button variant="outline" disabled={busy} onClick={()=>void load()}>刷新</Button>
        </>
      }
    />
    {error&&<AdminNotice tone="error" title={error} className="py-6" />}
    {notice&&<AdminNotice tone="success" title={notice} className="py-6" />}
    {!dashboard&&<AdminNotice tone="loading" title="正在读取 AI 成本数据…" />}
    {dashboard&&<>
      <AdminStatGrid>
        <AdminStat label="配置来源" value={dashboard.settings.source==='DATABASE'?'后台数据库':dashboard.settings.source==='ENVIRONMENT'?'服务器环境变量':'未配置'} hint={dashboard.settings.status==='invalid'?'配置格式错误':dashboard.settings.status==='enabled'?'预算数据可用':'当前无日预算'} icon={<Database className="h-4 w-4" />} />
        <AdminStat label="日预算熔断" value={dashboard.settings.circuitBreaker==='enabled'?'已启用':dashboard.settings.circuitBreaker==='invalid'?'配置无效':'关闭'} hint="只影响后续新请求，在途调用不会中断" tone={dashboard.settings.circuitBreaker==='enabled'?'success':'default'} icon={<ShieldOff className="h-4 w-4" />} />
        <AdminStat label="未确认成本" value={String(dashboard.budget.unknownCostCalls)} hint="含未定价模型、缺失用量及不完整重试" tone={dashboard.budget.unknownCostCalls>0?'warning':'default'} icon={<Coins className="h-4 w-4" />} />
        <AdminStat label="模型单价" value={dashboard.budget.pricingConfigured?'已配置':'待运营提供'} hint="模型价格历史优先，兼容旧环境单价" tone={dashboard.budget.pricingConfigured?'success':'warning'} icon={<Tag className="h-4 w-4" />} />
      </AdminStatGrid>

      {canManage&&<AdminPanel
        title="日预算设置"
        description="额度使用原币种；数据库配置生效后将取代环境变量预算。"
        badge={<Badge>{dashboard.settings.rows.length} 个币种</Badge>}
        actions={<Button size="sm" variant="outline" onClick={()=>setDraft(emptyDraft())}>新增币种预算</Button>}
      >
        <label className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={dashboard.settings.circuitBreaker==='enabled'} disabled={busy} onChange={event=>{const enabled=event.target.checked;setDashboard(current=>current?{...current,settings:{...current.settings,circuitBreaker:enabled?'enabled':'disabled'}}:current);void post('circuit-breaker',{enabled,version:dashboard.settings.circuitBreakerVersion,reason:'后台调整 AI 日预算熔断策略'});}}/>
          熔断达到预算后拒绝新的 AI 调用
        </label>
        {!dashboard.settings.rows.length&&<p className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">尚未保存数据库预算。服务器环境变量仍按兼容配置生效；未配置价格和预算时不会推测或扣除费用。</p>}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{dashboard.settings.rows.map(row=><article key={row.currency} className="min-w-0 space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{row.currency} · {row.isActive?'启用':'已停用'}</h3><span className="text-xs text-muted-foreground">版本 {row.version}</span></div>
          <p className="break-words text-sm text-muted-foreground">全站：{row.siteLimit===null?'未设置':formatAmount(row.siteLimit,row.currency)} / 日 · 单用户：{row.userLimit===null?'未设置':formatAmount(row.userLimit,row.currency)} / 日</p>
          <Button size="sm" variant="outline" onClick={()=>setDraft(emptyDraft(row))}>编辑预算</Button>
        </article>)}</div>
      </AdminPanel>}

      <AdminPanel title={`成本汇总（${days} 天）`} description="不同币种不换算；估算不会替代供应商账单对账。预算熔断不是在途费用的精确硬上限。" badge={<Badge>{dashboard.costs.length} 种币种</Badge>}>
        {!dashboard.costs.length
          ? <p className="text-sm text-muted-foreground">此期间没有 AI 调用记录。</p>
          : <div className="grid gap-3 lg:grid-cols-2">{dashboard.costs.map(row=><article key={row.currency} className="min-w-0 space-y-1 rounded-lg border p-3">
            <h3 className="font-medium">{row.currency} · 已知估算 {formatAmount(row.estimatedCost,row.currency)}</h3>
            <p className="break-words text-sm text-muted-foreground">总调用 {row.calls} · 实际调用 {row.realCalls} · 已知成本 {row.knownCostCalls} · 未知成本 {row.unknownCostCalls}</p>
            <p className="break-words text-sm text-muted-foreground">失败/取消 {row.failedCalls} · 模拟 {row.mockCalls} · 每千次 {row.costPerThousandCalls===null?'样本不足或含未知费用':formatAmount(row.costPerThousandCalls,row.currency)}</p>
          </article>)}</div>}
      </AdminPanel>

      {dashboard.budget.pricingUnpricedModels.length>0&&<AdminPanel title="启用模型缺少生效价格" description="先为以下模型登记价格和来源，再启用预算熔断；未知成本不会按零计算。" badge={<Badge variant="warning">{dashboard.budget.pricingUnpricedModels.length} 个模型</Badge>}>
        <ul className="list-inside list-disc break-words text-sm">{dashboard.budget.pricingUnpricedModels.map(model=><li key={model}>{model}</li>)}</ul>
      </AdminPanel>}

      <AdminPanel title="按模型成本" description="模型费用按调用时保存的价格版本归类；无价格快照的旧调用按供应商模型代码列为未定价项目。">
        {!dashboard.modelCosts.length
          ? <p className="text-sm text-muted-foreground">此期间暂无可按模型归集的 AI 调用。</p>
          : <div className="grid gap-3 lg:grid-cols-2">{dashboard.modelCosts.map((row,index)=><article key={`${row.modelId??row.providerModelCode??'unknown'}-${row.currency}-${index}`} className="min-w-0 space-y-1 rounded-lg border p-3">
            <h3 className="break-words font-medium">{row.displayName} · {row.currency}</h3>
            <p className="break-words text-sm text-muted-foreground">{row.modelKey??row.providerModelCode??'未识别模型'}{row.providerName?` · ${row.providerName}`:''}</p>
            <p className="break-words text-sm text-muted-foreground">调用 {row.calls} · 已知成本 {row.knownCostCalls} · 未知成本 {row.unknownCostCalls} · 失败/取消 {row.failedCalls}</p>
            <p className="text-sm">已知估算 {formatAmount(row.estimatedCost,row.currency)}</p>
          </article>)}</div>}
      </AdminPanel>

      <AdminPanel title="预算告警" description="已知费用触达预算即告警；每次调用的实际扣费以供应商账单为准。" badge={<Badge variant={dashboard.budget.alerts.length>0?'warning':'success'}>{dashboard.budget.alerts.length} 条</Badge>}>
        {!dashboard.budget.alerts.length
          ? <p className="text-sm text-muted-foreground">当前没有已知费用触达预算的告警。</p>
          : <div className="space-y-1">{dashboard.budget.alerts.map((alert,index)=><p key={`${alert.scope}-${alert.currency}-${index}`} className="break-words text-sm">{alert.scope==='site'?'全站':'单用户'} · {alert.currency} · 已知 {formatAmount(alert.knownCost,alert.currency)} / 预算 {formatAmount(alert.budget,alert.currency)}</p>)}</div>}
        {dashboard.budget.unknownCostCalls>0&&<p className="mt-3 text-sm text-amber-600">另有 {dashboard.budget.unknownCostCalls} 次调用费用未知，须核对后才能作为完整成本。</p>}
      </AdminPanel>

      <p className="text-xs text-muted-foreground">报告时间：{new Date(dashboard.generatedAt).toLocaleString('zh-CN')} · 预算时间口径 UTC</p>
    </>}
    {children}

    <Dialog
      open={Boolean(draft)}
      onClose={()=>setDraft(null)}
      title={draft?.isExisting?'编辑预算':'新增预算'}
      description="设置预算不代表模型单价已确认；未知费用仍单独标记。保存会写入管理审计。"
      footer={
        <>
          <Button variant="outline" onClick={()=>setDraft(null)}>取消</Button>
          <Button type="submit" form="ai-budget-form" disabled={busy||!canManage}>{busy?'保存中…':'保存预算'}</Button>
        </>
      }
    >
      {draft&&<form id="ai-budget-form" onSubmit={submitBudget} className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">币种代码</span>
          <Input required disabled={draft.isExisting} maxLength={3} pattern="[A-Za-z]{3}" className="uppercase" value={draft.currency} onChange={event=>setDraft({...draft,currency:event.target.value.toUpperCase()})} />
        </label>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">预算状态</span>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={event=>setDraft({...draft,isActive:event.target.checked})} />参与新请求预算判断</label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">全站每日预算</span>
          <Input type="number" min="0.000001" step="0.000001" inputMode="decimal" value={draft.siteLimit} onChange={event=>setDraft({...draft,siteLimit:event.target.value})} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">单用户每日预算</span>
          <Input type="number" min="0.000001" step="0.000001" inputMode="decimal" value={draft.userLimit} onChange={event=>setDraft({...draft,userLimit:event.target.value})} />
        </label>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium">操作理由</span>
          <Input required maxLength={300} value={draft.reason} onChange={event=>setDraft({...draft,reason:event.target.value})} />
        </label>
      </form>}
    </Dialog>
  </AdminPage>;
}
