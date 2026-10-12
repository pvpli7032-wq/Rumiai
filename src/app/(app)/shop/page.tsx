'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { Coins, ShoppingBag, Loader2, CheckCircle2 } from 'lucide-react';

interface CoinPackage {
  id: string;
  coins: number;
  priceCnyCents: number | null;
  bonus: number;
  label: string;
}

function formatCny(cents: number | null): string {
  if (!cents) return '人民币价格待配置';
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
}

export default function ShopPage() {
  const { user, token, refreshUser } = useAuth();
  const router = useRouter();
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [purchaseEnabled, setPurchaseEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [shopError, setShopError] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<{ packageId: string; key: string; quote: { amountCnyCents: number; coinAmount: number } } | null>(null);
  const [returnOrder, setReturnOrder] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState('');
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;

  useEffect(() => {
    fetch('/api/coins/packages')
      .then(async r => ({ packages: await r.json(), enabled: r.headers.get('X-Checkout-Enabled') === 'true' }))
      .then(data => {
        if (Array.isArray(data.packages)) setPackages(data.packages);
        setPurchaseEnabled(data.enabled);
      })
      .catch(() => setShopError('暂时无法读取充值套餐。'))
      .finally(() => setLoading(false));
    const returned = new URLSearchParams(window.location.search).get('payment');
    if (returned && /^[A-Z0-9]{20,40}$/.test(returned)) setReturnOrder(returned);
  }, []);

  useEffect(() => {
    if (!returnOrder || !token) return;
    let stopped = false;
    async function checkPayment() {
      for (let attempt = 0; attempt < 12 && !stopped; attempt++) {
        try {
          const response = await fetch(`/api/coins/orders/${encodeURIComponent(returnOrder!)}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          });
          if (response.ok) {
            const order = await response.json();
            if (order.status === 'PAID') {
              setPaymentMessage('支付已确认，金币已到账。');
              await refreshUserRef.current();
              return;
            }
          }
        } catch { /* The next poll can recover a temporary network interruption. */ }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!stopped) setPaymentMessage('暂未收到到账通知，订单仍在核对中；请稍后刷新余额。');
    }
    void checkPayment();
    return () => { stopped = true; };
  }, [returnOrder, token]);

  async function handlePurchase(pkg: CoinPackage) {
    if (!token) { router.push(loginWithNext()); return; }
    if (!purchaseEnabled || !pkg.priceCnyCents) return;
    setShopError(null);
    setPurchasing(pkg.id);
    const pending = pendingRequest?.packageId === pkg.id ? pendingRequest : { packageId: pkg.id, key: crypto.randomUUID(), quote: { amountCnyCents: pkg.priceCnyCents!, coinAmount: pkg.coins + pkg.bonus } };
    const key = pending.key;
    setPendingRequest(pending);
    try {
      const res = await fetch('/api/coins/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packageId: pkg.id, idempotencyKey: key, quote: pending.quote }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShopError(data.error || '创建支付订单失败。');
        if (data.code === 'PACKAGE_CHANGED') {
          setPendingRequest(null);
          const latest = await fetch('/api/coins/packages', { cache: 'no-store' });
          const catalog = await latest.json();
          if (latest.ok && Array.isArray(catalog)) setPackages(catalog);
        }
        return;
      }
      if (data.status === 'PAID') {
        setSuccessId(pkg.id);
        await refreshUser();
        return;
      }
      if (typeof data.redirectUrl !== 'string') {
        setShopError('订单已创建，但支付链接暂不可用。请稍后重试。');
        return;
      }
      window.location.assign(data.redirectUrl);
    } catch {
      setShopError('网络暂时中断。再次点击会使用同一请求编号，避免重复创建订单。');
    } finally {
      setPurchasing(null);
    }
  }

  const PKG_COLORS = [
    'border-zinc-700 hover:border-zinc-500',
    'border-blue-500/30 hover:border-blue-500/60 bg-blue-500/5',
    'border-purple-500/30 hover:border-purple-500/60 bg-purple-500/5',
    'border-yellow-500/30 hover:border-yellow-500/60 bg-yellow-500/5',
    'border-pink-500/30 hover:border-pink-500/60 bg-pink-500/5',
    'border-red-500/30 hover:border-red-500/60 bg-red-500/5',
  ];

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-yellow-500 to-amber-500 shadow-xl shadow-yellow-500/30">
            <ShoppingBag className="h-8 w-8 text-white" />
          </div>
          <h1 className="mb-2 text-3xl font-bold text-white">金币充值</h1>
          <p className="text-zinc-400">为喜欢的角色赠送礼物</p>
          {user && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-4 py-2">
              <Coins className="h-4 w-4 text-yellow-400" />
              <span className="font-bold text-yellow-400">{user.coins.toLocaleString()} 金币</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /></div>
        ) : packages.length === 0 ? (
          <p className="py-12 text-center text-zinc-400">当前没有可用套餐。</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {packages.map((pkg, i) => {
              const canBuy = purchaseEnabled && Boolean(pkg.priceCnyCents);
              return (
                <div key={pkg.id} className={`relative rounded-2xl border p-5 transition-all ${PKG_COLORS[i % PKG_COLORS.length]}`}>
                  <div className="mb-4 text-center">
                    <div className="mb-2 text-4xl">🪙</div>
                    <p className="text-2xl font-bold text-yellow-400">{pkg.coins.toLocaleString()}</p>
                    {pkg.bonus > 0 && <p className="text-xs text-green-400">额外赠送 {pkg.bonus.toLocaleString()} 金币</p>}
                    <p className="mt-1 text-sm text-zinc-400">{pkg.label}</p>
                  </div>
                  <div className="mb-4 text-center text-lg font-bold text-white">{formatCny(pkg.priceCnyCents)}</div>
                  <button
                    onClick={() => void handlePurchase(pkg)}
                    disabled={!canBuy || purchasing === pkg.id}
                    className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                      successId === pkg.id
                        ? 'border border-green-500/40 bg-green-500/20 text-green-400'
                        : 'bg-gradient-to-r from-yellow-500 to-amber-500 text-white shadow-lg shadow-yellow-500/20 hover:opacity-90'
                    }`}
                  >
                    {purchasing === pkg.id ? (
                      <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />正在创建订单…</span>
                    ) : successId === pkg.id ? (
                      <span className="flex items-center justify-center gap-2"><CheckCircle2 className="h-4 w-4" />已到账</span>
                    ) : !pkg.priceCnyCents ? '待配置人民币价格' : purchaseEnabled ? `支付 ${formatCny(pkg.priceCnyCents)}` : '支付渠道待配置'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-white/10 bg-zinc-900 p-4 text-center">
          <p className="text-sm text-amber-200">
            {purchaseEnabled ? '支付成功后，服务端核验 EZFP 异步通知再发放金币。' : '支付渠道或人民币套餐价格尚未配置，当前不会发生扣款。'}
          </p>
          {paymentMessage && <p role="status" className="mt-2 text-sm text-green-300">{paymentMessage}</p>}
          {shopError && <p role="alert" className="mt-2 text-sm text-red-300">{shopError}</p>}
        </div>
      </div>
    </div>
  );
}
