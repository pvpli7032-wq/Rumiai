'use client';

import {useEffect, useRef, useState} from 'react';
import {AdminNotice, AdminPage, AdminPanel} from '@admin/components/admin-page';
import {AdminPageHeader} from '@admin/components/layout/admin-page-header';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {MEMBERSHIP_BENEFIT_RULES, type MembershipBenefit as Benefit, type MembershipPlanPublic as Plan, type MembershipCatalogPublic as Catalog} from '@rumiai/contracts/memberships';
import {useUnsavedGuard} from '@admin/components/settings/use-unsaved-guard';
import {useAdminAccess} from '../use-admin-access';
import {Badge} from '@rumiai/ui/badge';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@rumiai/ui/tabs';

const LABELS = {DAILY_FREE_REPLIES: '每日额外免费回复', CHAT_PRICE_MULTIPLIER: '聊天收费倍率（0.8 表示八折）', CHARACTER_CREATE_LIMIT: '会员角色总上限'} as const;
const DEFS = (Object.keys(LABELS) as Array<keyof typeof LABELS>).map(key => [key, LABELS[key], MEMBERSHIP_BENEFIT_RULES[key].min, MEMBERSHIP_BENEFIT_RULES[key].max] as const);
const defaults: Catalog = {policy: {version: 0, refundWindowHours: 24, usageChargePeriodHours: 24}, plans: []};

function PolicyPanel({policy, onChange}: {policy: Catalog['policy']; onChange: (policy: Catalog['policy']) => void}) {
  return <AdminPanel title="退款与扣费规则" description="规则由后台统一写入，前台购买和退款流程读取同一份配置.">
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium" htmlFor="refund-window">退款窗口（小时）<Input id="refund-window" aria-label="退款窗口（小时）" className="mt-1.5" type="number" min={1} max={168} value={policy.refundWindowHours} onChange={e => onChange({...policy, refundWindowHours: Number(e.target.value)})} /></label>
      <label className="text-sm font-medium" htmlFor="usage-period">使用后扣费周期（小时）<Input id="usage-period" aria-label="使用后扣费周期（小时）" className="mt-1.5" type="number" min={1} max={720} value={policy.usageChargePeriodHours} onChange={e => onChange({...policy, usageChargePeriodHours: Number(e.target.value)})} /></label>
    </div>
  </AdminPanel>;
}

function BenefitEditor({plan, index, benefit, onToggle, onChange}: {plan: Plan; index: number; benefit: (key: Benefit['key']) => Benefit | undefined; onToggle: (index: number, key: Benefit['key'], enabled: boolean) => void; onChange: (index: number, key: Benefit['key'], patch: Partial<Benefit>) => void}) {
  return <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">可执行权益</legend>
    {DEFS.map(([key, label, min, max]) => { const item = benefit(key); return <div key={key} className="rounded-xl border border-border bg-muted/20 p-3">
      <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" aria-label={`启用${label}`} checked={!!item} onChange={e => onToggle(index, key, e.target.checked)} />{label}</label>
      {item && <div className="mt-2 grid gap-2"><label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-${key}-label`}>权益名称<Input id={`${plan.id}-${key}-label`} aria-label={`${label}显示名称`} value={item.label} onChange={e => onChange(index, key, {label: e.target.value})} /></label><label className="text-xs text-muted-foreground" htmlFor={`${plan.id}-${key}-value`}>权益数值<Input id={`${plan.id}-${key}-value`} aria-label={`${label}数值`} type="number" min={min} max={max} step={MEMBERSHIP_BENEFIT_RULES[key].kind === 'integer' ? 1 : 0.01} value={item.value} onChange={e => onChange(index, key, {value: Number(e.target.value)})} /></label></div>}
    </div>; })}
  </fieldset>;
}

function PlanEditor({plan, index, updatePlan, benefit, toggleBenefit, updateBenefit}: {plan: Plan; index: number; updatePlan: (index: number, patch: Partial<Plan>) => void; benefit: (plan: Plan, key: Benefit['key']) => Benefit | undefined; toggleBenefit: (index: number, key: Benefit['key'], enabled: boolean) => void; updateBenefit: (index: number, key: Benefit['key'], patch: Partial<Benefit>) => void}) {
  return <AdminPanel title={plan.name} badge={plan.isActive ? '前台开放' : '已停用'}>
    <div className="grid gap-6 xl:grid-cols-[minmax(250px,0.8fr)_minmax(360px,1.2fr)]">
      <div className="space-y-4">
        <label className="block text-sm font-medium" htmlFor={`${plan.id}-name`}>方案名称<Input id={`${plan.id}-name`} aria-label="方案名称" className="mt-1.5" value={plan.name} onChange={e => updatePlan(index, {name: e.target.value})} /></label>
        <label className="block text-sm font-medium" htmlFor={`${plan.id}-price`}>价格（分）<Input id={`${plan.id}-price`} aria-label="方案价格（分）" className="mt-1.5" type="number" min={1} value={plan.priceCents ?? ''} onChange={e => updatePlan(index, {priceCents: e.target.value === '' ? null : Number(e.target.value)})} /></label>
        <label className="block text-sm font-medium" htmlFor={`${plan.id}-duration`}>时长（天）<Input id={`${plan.id}-duration`} aria-label="方案时长（天）" className="mt-1.5" type="number" min={1} readOnly={plan.code === 'MONTHLY'} value={plan.durationDays} onChange={e => updatePlan(index, {durationDays: Number(e.target.value)})} /></label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-brand-soft/30 px-3 text-sm font-medium"><input type="checkbox" aria-label="前台开放购买" checked={plan.isActive} onChange={e => updatePlan(index, {isActive: e.target.checked})} />前台开放购买</label>
      </div>
      <BenefitEditor plan={plan} index={index} benefit={key => benefit(plan, key)} onToggle={toggleBenefit} onChange={updateBenefit} />
    </div>
  </AdminPanel>;
}

export function MembershipManagement() {
  const {sessionActive, permissions, loading: accessLoading} = useAdminAccess();
  const canRead = permissions.includes('finance.read');
  const canWrite = permissions.includes('finance.packages.write');
  const [catalog, setCatalog] = useState<Catalog>(defaults);
  const savedSnapshot = useRef<string | null>(null);
  const [activePanel, setActivePanel] = useState('policy');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!sessionActive || !canRead) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setMessage('');
    fetch('/api/admin/memberships', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
      .then(r => r.ok ? r.json() : Promise.reject(new Error('会员配置读取失败，请重试。')))
      .then((data: Catalog) => { if (!controller.signal.aborted) { savedSnapshot.current = JSON.stringify(data); setCatalog(data); } })
      .catch(() => { if (!controller.signal.aborted) setMessage('会员配置读取失败，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionActive, canRead, reload]);
  const dirty = savedSnapshot.current !== null && JSON.stringify(catalog) !== savedSnapshot.current;
  useUnsavedGuard(dirty, '会员配置有未保存的修改，确定离开吗？');
  const updatePlan = (index: number, patch: Partial<Plan>) => setCatalog(c => ({...c, plans: c.plans.map((plan, i) => i === index ? {...plan, ...patch} : plan)}));
  const benefit = (plan: Plan, key: Benefit['key']) => plan.benefits.find(item => item.key === key);
  const toggleBenefit = (index: number, key: Benefit['key'], enabled: boolean) => setCatalog(c => ({...c, plans: c.plans.map((plan, i) => { if (i !== index) return plan; const old = benefit(plan, key); return {...plan, benefits: enabled ? [...plan.benefits.filter(item => item.key !== key), {key, label: old?.label ?? LABELS[key], value: old?.value ?? 1}] : plan.benefits.filter(item => item.key !== key)}; })}));
  const updateBenefit = (index: number, key: Benefit['key'], patch: Partial<Benefit>) => setCatalog(c => ({...c, plans: c.plans.map((plan, i) => i !== index ? plan : {...plan, benefits: plan.benefits.map(item => item.key === key ? {...item, ...patch} : item)})}));
  async function save() {
    if (saving || !canWrite || !savedSnapshot.current) return; setSaving(true); setMessage(''); let savedCount = 0;
    try {
      if (catalog.plans.some(plan => plan.priceCents !== null && (!Number.isSafeInteger(plan.priceCents) || plan.priceCents < 1))) throw Error('已定价套餐价格必须为正整数分；未定价请留空。');
      const policyResponse = await fetch('/api/admin/memberships', {method: 'PATCH', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify({kind: 'policy', ...catalog.policy, reason: '后台会员规则配置'})});
      if (!policyResponse.ok) throw Error((await policyResponse.json()).error ?? '保存退款规则失败。');
      let next: Catalog = {...catalog, policy: await policyResponse.json()}; setCatalog(next); savedCount++;
      for (const plan of catalog.plans) { const response = await fetch('/api/admin/memberships', {method: 'PATCH', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify({...plan, reason: '后台会员套餐配置'})}); if (!response.ok) throw Error((await response.json()).error ?? `保存${plan.name}失败。`); const saved: Plan = await response.json(); next = {...next, plans: next.plans.map(item => item.id === saved.id ? saved : item)}; setCatalog(next); savedCount++; }
      savedSnapshot.current = JSON.stringify(next);
      setMessage('已保存，前台将读取最新方案。');
    } catch (error) { setMessage(`${savedCount ? `部分未保存（此前 ${savedCount} 项已生效）：` : ''}${error instanceof Error ? error.message : '保存失败，请重试。'}`); } finally { setSaving(false); }
  }
  if (accessLoading || loading) return <AdminPage><AdminNotice tone="loading" title="正在读取会员配置…" /></AdminPage>;
  if (!canRead) return <AdminPage><AdminPageHeader title="会员方案" /><AdminNotice tone="denied" title="当前账号没有会员方案查看权限。" /></AdminPage>;
  if (!savedSnapshot.current) return <AdminPage><AdminPageHeader title="会员方案" /><AdminNotice tone="error" title={message || '会员配置尚未读取。'} action={<Button variant="outline" onClick={() => setReload(value => value + 1)}>重新读取</Button>} /></AdminPage>;
  return <AdminPage width="default"><AdminPageHeader eyebrow="财务与商业" title="会员方案" description="价格、时长、可执行权益与退款规则统一配置。" meta={<Badge variant={canWrite ? 'brand' : 'neutral'}>{canWrite ? '可编辑' : '只读'}</Badge>} />
    {message && <AdminNotice tone={message.startsWith('已') ? 'success' : 'error'} title={message} />}
    <div className="grid grid-cols-3 gap-2 sm:gap-3"><div className="rounded-2xl border border-border bg-brand-soft/20 p-4"><p className="text-xs text-muted-foreground">前台方案</p><p className="mt-1 text-2xl font-semibold text-foreground">{catalog.plans.filter(plan => plan.isActive).length}<span className="ml-1 text-sm font-normal text-muted-foreground">个开放</span></p></div><div className="rounded-2xl border border-border bg-muted/30 p-4"><p className="text-xs text-muted-foreground">退款窗口</p><p className="mt-1 text-2xl font-semibold text-foreground">{catalog.policy.refundWindowHours}<span className="ml-1 text-sm font-normal text-muted-foreground">小时</span></p></div><div className="rounded-2xl border border-border bg-muted/30 p-4"><p className="text-xs text-muted-foreground">权益扣费周期</p><p className="mt-1 text-2xl font-semibold text-foreground">{catalog.policy.usageChargePeriodHours}<span className="ml-1 text-sm font-normal text-muted-foreground">小时</span></p></div></div>
    <Tabs value={activePanel} onValueChange={setActivePanel}>
      <TabsList aria-label="会员配置分区"><TabsTrigger value="policy">退款规则</TabsTrigger>{catalog.plans.map(plan => <TabsTrigger key={plan.id} value={plan.id}>{plan.name}</TabsTrigger>)}</TabsList>
      <fieldset disabled={saving || !canWrite} className="min-w-0">
        <TabsContent value="policy"><PolicyPanel policy={catalog.policy} onChange={policy => setCatalog(current => ({...current, policy}))} /></TabsContent>
        {catalog.plans.map((plan, index) => <TabsContent key={plan.id} value={plan.id}><PlanEditor plan={plan} index={index} updatePlan={updatePlan} benefit={benefit} toggleBenefit={toggleBenefit} updateBenefit={updateBenefit} /></TabsContent>)}
      </fieldset>
    </Tabs>
    {canWrite && <div className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"><p role="status" className="text-xs text-muted-foreground">{dirty ? '有未保存的修改' : '配置已同步'}</p><Button onClick={() => void save()} disabled={saving || !dirty}>{saving ? '保存中…' : '保存配置'}</Button></div>}
    <p className="rounded-xl border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">角色权益表示会员总上限。须先在设置中心配置有限的公共角色数量上限；默认公共不限制时，这项权益没有额外增益，不开放为可购买权益。</p>
  </AdminPage>;
}
