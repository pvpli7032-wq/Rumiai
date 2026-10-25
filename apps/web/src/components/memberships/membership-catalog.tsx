'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@rumiai/ui/button';
import {useAuth} from '@web/lib/auth-context';
import {formatDateTime} from '@rumiai/contracts/format/date-time';
import type {MembershipAccountPublic,MembershipCatalogPublic,MembershipPlanPublic} from '@rumiai/contracts/memberships';
import {membershipApi} from './membership-api';
import {MembershipOrders} from './membership-orders';

const errorText=(value:unknown)=>value instanceof Error?value.message:'操作失败，请稍后重试。';
type AvailablePlan=MembershipPlanPublic & {priceCents:number};
export function MembershipCatalog() {
  const {token,isLoading:authLoading,refreshUser}=useAuth();
  const [catalog,setCatalog]=useState<MembershipCatalogPublic|null>(null);
  const [account,setAccount]=useState<MembershipAccountPublic|null>(null);
  const [accountOwner,setAccountOwner]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [accountLoading,setAccountLoading]=useState(false);
  const [accountRetry,setAccountRetry]=useState(0);
  const [ordersLoading,setOrdersLoading]=useState(false);
  const [checkout,setCheckout]=useState<{enabled:boolean;reason:string}>({enabled:false,reason:''});
  const [busy,setBusy]=useState<string|null>(null);
  const [refundBusy,setRefundBusy]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const checkoutKeys=useRef(new Map<string,string>());
  const sessionToken=useRef(token);
  sessionToken.current=token;

  const loadCatalog=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const [nextCatalog, availability] = await Promise.all([membershipApi.catalog(), membershipApi.checkoutAvailability()]);
      setCatalog(nextCatalog); setCheckout(availability);
    } catch(value) { setError(errorText(value)); } finally { setLoading(false); }
  },[]);
  useEffect(()=>{void loadCatalog();},[loadCatalog]);
  useEffect(()=>{
    let active=true;
    setAccount(null);setAccountOwner(token);checkoutKeys.current.clear();setError('');setNotice('');
    if(!token){setAccountLoading(false);return;}
    let timer:ReturnType<typeof setTimeout>|undefined;
    let attempts=0;
    const returningFromPayment=new URLSearchParams(window.location.search).has('payment');
    setAccountLoading(true);
    const refresh=async()=>{
      try {
        const value=await membershipApi.account(token);
        if(!active)return;
        setAccount(value);
        if(returningFromPayment&&value.orders.some(order=>order.status==='PENDING')&&attempts++<10){
          if(timer)clearTimeout(timer);
          timer=setTimeout(()=>void refresh(),3000);
        }
      }catch(value){if(active)setError(errorText(value));}finally{if(active)setAccountLoading(false);}
    };
    const onFocus=()=>void refresh();
    void refresh();
    window.addEventListener('focus',onFocus);
    return()=>{active=false;if(timer)clearTimeout(timer);window.removeEventListener('focus',onFocus);};
  },[token, accountRetry]);

  async function loadMoreOrders() {
    const cursor=account?.nextOrderCursor;
    if(!token||!cursor||ordersLoading)return;
    setOrdersLoading(true);setError('');
    try {
      const value=await membershipApi.account(token,cursor);
      if(sessionToken.current!==token)return;
      setAccount(previous=>previous?{...value,orders:[...previous.orders,...value.orders.filter(order=>!previous.orders.some(existing=>existing.orderNo===order.orderNo))]}:value);
    }catch(cause){if(sessionToken.current===token)setError(errorText(cause));}
    finally{setOrdersLoading(false);}
  }
  async function buy(plan:AvailablePlan) {
    if(!token||busy||refundBusy||!checkout.enabled)return;
    setBusy(plan.id);setError('');setNotice('');
    // An uncertain network result retries the same order, not another renewal.
    const key=checkoutKeys.current.get(plan.id)??`membership-${crypto.randomUUID()}`;
    checkoutKeys.current.set(plan.id,key);
    try {
      const result=await membershipApi.checkout(token,plan.code,key);
      if(sessionToken.current!==token)return;
      if(result.redirectUrl){window.location.assign(result.redirectUrl);return;}
      if(result.status==='PAID'){
        checkoutKeys.current.delete(plan.id);
        const updated=await membershipApi.account(token);
        if(sessionToken.current===token){setAccount(updated);await refreshUser();setNotice('支付已确认，会员有效期已更新。');}
      }else setNotice('订单已创建，但未取得支付入口，请重试同一订单。');
    }catch(value){if(sessionToken.current===token)setError(errorText(value));}finally{setBusy(null);}
  }
  async function refund(orderNo:string) {
    if(!token||refundBusy||busy)return;
    setRefundBusy(orderNo);setError('');setNotice('');
    try {
      const quote=await membershipApi.refundQuote(token,orderNo);
      if(sessionToken.current!==token)return;
      if(!quote.eligible)throw Error(quote.reason??'当前订单不可退款。');
      if(!window.confirm(`退款金额 ¥${(quote.amountCents/100).toFixed(2)}，使用权益扣费 ¥${(quote.deductedCents/100).toFixed(2)}。确认退款？`))return;
      await membershipApi.refund(token,orderNo);
      if(sessionToken.current===token)setNotice('退款请求已提交，正在按渠道结果刷新会员状态。');
    }catch(value){if(sessionToken.current===token)setError(errorText(value));}finally{
      // Pending and failed states also need refreshing so users can retry.
      try{const updated=await membershipApi.account(token);if(sessionToken.current===token){setAccount(updated);await refreshUser();}}catch(value){if(sessionToken.current===token)setError(errorText(value));}
      setRefundBusy(null);
    }
  }
  const visibleAccount=accountOwner===token?account:null;
  const plans=catalog?.plans.filter((plan):plan is AvailablePlan=>plan.isActive&&plan.priceCents!==null&&plan.priceCents>0)??[];
  return <section className="mx-auto max-w-5xl space-y-6 px-4 py-12">
    <header>
      <p className="text-sm font-semibold text-brand">会员中心</p>
      <h1 className="mt-2 text-3xl font-semibold">选择适合你的会员方案</h1>
      <p className="mt-2 text-sm text-muted-foreground">付款成功后生效，按完整 24 小时计时；手动续费衔接已有期限，不自动扣款。</p>
    </header>
    {error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p>{error}</p>{token&&<button className="mt-2 min-h-10 rounded-lg border border-input px-3 text-foreground" onClick={()=>setAccountRetry(value=>value+1)}>重新读取账户</button>}</div>}
    {notice&&<p role="status" className="rounded-lg border border-brand/30 p-3 text-sm">{notice}</p>}
    {accountLoading&&<p role="status" className="text-sm text-muted-foreground">正在读取会员有效期与订单…</p>}
    {visibleAccount?.membership&&<div className="rounded-xl border border-brand/30 bg-brand-soft/30 p-5">
      <p className="text-sm font-semibold">当前会员：{visibleAccount.orders.find(order=>order.orderNo===visibleAccount.membership?.orderNo)?.planName??visibleAccount.membership.planCode}</p>
      <p className="mt-1 text-sm text-muted-foreground">当前权益期至 {formatDateTime(visibleAccount.membership.expiresAt)}</p>
      <p className="mt-1 text-sm text-muted-foreground">含续费有效期至 {formatDateTime(visibleAccount.membership.renewalExpiresAt??visibleAccount.membership.expiresAt)}</p>
    </div>}
    {visibleAccount&&<MembershipOrders token={token} orders={visibleAccount.orders} busy={refundBusy} onRefund={orderNo=>void refund(orderNo)}/>}
    {visibleAccount?.nextOrderCursor&&<Button variant="outline" disabled={ordersLoading} onClick={()=>void loadMoreOrders()}>{ordersLoading?'正在读取订单…':'加载更多会员订单'}</Button>}
    {catalog&&catalog.benefitDefinitions&&catalog.benefitDefinitions.length>0&&<section aria-label="会员权益说明" className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">权益如何生效</h2><div className="mt-3 space-y-4">{catalog.benefitDefinitions.map(definition=><div key={definition.key}><p className="text-sm font-medium">{definition.label} · {definition.unit}</p><p className="mt-1 text-sm text-muted-foreground">{definition.description}</p><p className="mt-1 text-xs text-muted-foreground">适用范围：{definition.scope}</p></div>)}</div></section>}
    {loading?<p role="status" className="text-sm text-muted-foreground">正在读取会员方案…</p>:!catalog?<Button variant="outline" onClick={()=>void loadCatalog()}>重新读取会员方案</Button>:plans.length===0?<div className="rounded-xl border border-border p-8 text-sm text-muted-foreground">当前没有开放购买的会员方案。</div>:<div className="grid gap-4 md:grid-cols-3">{plans.map(plan=><article key={plan.id} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{plan.name}</h2>
      <p className="mt-4 text-3xl font-bold">¥{(plan.priceCents/100).toFixed(2)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{plan.durationDays} × 24 小时</p>
      <ul className="mt-5 space-y-2 text-sm">{plan.benefits.map(item=><li key={item.key} className="flex justify-between gap-3"><span>{item.label}</span><span className="font-medium">{item.key==='CHAT_PRICE_MULTIPLIER'?`${item.value} 倍`:item.key==='DAILY_FREE_REPLIES'?`${item.value} 次/日`:`${item.value} 个`}</span></li>)}</ul>
      <Button className="mt-6 w-full" disabled={authLoading||!token||busy!==null||refundBusy!==null||!checkout.enabled} onClick={()=>void buy(plan)}>{busy===plan.id?'正在创建订单…':!checkout.enabled?(checkout.reason==='CHECKOUT_DISABLED'?'购买暂未开放':'支付渠道暂不可用'):visibleAccount?.membership?'手动续费':'购买会员'}</Button>
    </article>)}</div>}
    {catalog&&!checkout.enabled&&<p role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{checkout.reason==='CHECKOUT_DISABLED'?'会员购买暂未开放，当前不会创建订单或发生扣款。':'支付渠道暂不可用，当前不会创建订单。'}</p>}
    {!authLoading&&!token&&<p className="text-sm text-muted-foreground">购买前请<Link href="/login?next=%2Fmembership" className="ml-1 text-brand underline">登录账号</Link>。</p>}
    {catalog&&<p className="text-xs leading-relaxed text-muted-foreground">新订单支付后 {catalog.policy.refundWindowHours} 小时内可申请退款。未使用权益全额退款；使用后按实付金额和套餐时长扣除 {catalog.policy.usageChargePeriodHours} 小时费用，金额向上取整到分。历史订单以购买时的规则快照及退款预览为准。</p>}
  </section>;
}
