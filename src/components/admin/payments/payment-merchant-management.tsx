'use client';

import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {CheckoutSettings} from './checkout-settings';

type Merchant = {
  id: string;
  name: string;
  provider: string;
  environment: string;
  isActive: boolean;
  version: number;
  currentRevision: {
    revision: number;
    merchantNo: string;
    apiBaseUrl: string;
    refundsEnabled: boolean;
    createdAt: string;
    hasMerchantPrivateKey: boolean;
    hasPlatformPublicKey: boolean;
  } | null;
};

type MerchantDraft = {
  id?: string;
  version: number;
  name: string;
  environment: 'TEST' | 'PRODUCTION';
  isActive: boolean;
  merchantNo: string;
  apiBaseUrl: string;
  merchantPrivateKey: string;
  platformPublicKey: string;
  refundsEnabled: boolean;
  reason: string;
};

type MerchantFormProps = {
  initial: MerchantDraft;
  canManage: boolean;
  canManageSecrets: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: MerchantDraft) => Promise<void>;
};

function newDraft(): MerchantDraft {
  return {
    version: 0,
    name: '',
    environment: 'TEST',
    isActive: false,
    merchantNo: '',
    apiBaseUrl: 'http://127.0.0.1:19090',
    merchantPrivateKey: '',
    platformPublicKey: '',
    refundsEnabled: false,
    reason: '',
  };
}

function draftFromMerchant(merchant: Merchant): MerchantDraft {
  return {
    id: merchant.id,
    version: merchant.version,
    name: merchant.name,
    environment: merchant.environment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
    isActive: merchant.isActive,
    merchantNo: merchant.currentRevision?.merchantNo ?? '',
    apiBaseUrl: merchant.currentRevision?.apiBaseUrl ?? 'http://127.0.0.1:19090',
    merchantPrivateKey: '',
    platformPublicKey: '',
    refundsEnabled: merchant.currentRevision?.refundsEnabled ?? false,
    reason: '',
  };
}

function MerchantForm({initial, canManage, canManageSecrets, busy, onCancel, onSave}: MerchantFormProps) {
  const [draft, setDraft] = useState(initial);

  function update<K extends keyof MerchantDraft>(key: K, value: MerchantDraft[K]) {
    setDraft(current => ({...current, [key]: value}));
  }

  function changeEnvironment(environment: MerchantDraft['environment']) {
    setDraft(current => ({
      ...current,
      environment,
      apiBaseUrl: environment === 'TEST' ? 'http://127.0.0.1:19090' : 'https://www.ezfp.cn',
      isActive: environment === 'TEST' ? false : current.isActive,
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(draft);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-3 sm:p-6">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="merchant-form-title"
        onSubmit={submit}
        className="mx-auto my-4 max-w-2xl space-y-4 rounded-2xl bg-background p-4 shadow-xl sm:p-6"
      >
        <div className="flex justify-between gap-3">
          <h2 id="merchant-form-title" className="text-xl font-bold">
            {draft.id ? '编辑商户并生成新版本' : '新增商户'}
          </h2>
          <button type="button" className="min-h-10 px-3" onClick={onCancel}>关闭</button>
        </div>

        <label className="block space-y-1 text-sm">
          商户名称
          <input
            required
            maxLength={60}
            className="min-h-11 w-full rounded-lg border bg-background px-3"
            value={draft.name}
            onChange={event => update('name', event.target.value)}
          />
        </label>

        <label className="block space-y-1 text-sm">
          环境
          <select
            className="min-h-11 w-full rounded-lg border bg-background px-3"
            value={draft.environment}
            onChange={event => changeEnvironment(event.target.value as MerchantDraft['environment'])}
          >
            <option value="TEST">本机模拟</option>
            <option value="PRODUCTION">正式 EZFP</option>
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          商户编号
          <input
            required
            maxLength={30}
            inputMode="numeric"
            className="min-h-11 w-full rounded-lg border bg-background px-3"
            value={draft.merchantNo}
            onChange={event => update('merchantNo', event.target.value)}
          />
        </label>

        <label className="block space-y-1 text-sm">
          API Base URL
          <input
            required
            readOnly
            className="min-h-11 w-full rounded-lg border bg-muted px-3"
            value={draft.apiBaseUrl}
          />
        </label>

        <label className="block space-y-1 text-sm">
          商户 RSA 私钥
          {draft.id && <span className="text-muted-foreground">（留空沿用当前版本）</span>}
          <textarea
            required={!draft.id}
            disabled={!canManageSecrets}
            rows={4}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border bg-background p-3 font-mono text-xs"
            value={draft.merchantPrivateKey}
            onChange={event => update('merchantPrivateKey', event.target.value)}
          />
          <span className="block text-muted-foreground">填写生成 RSA 密钥对时保存的商户私钥，不是商户公钥或 MD5 密钥。支持 PEM 和不带头尾的 Base64。</span>
        </label>

        <label className="block space-y-1 text-sm">
          支付平台 RSA 公钥
          {draft.id && <span className="text-muted-foreground">（留空沿用当前版本）</span>}
          <textarea
            required={!draft.id}
            disabled={!canManageSecrets}
            rows={4}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border bg-background p-3 font-mono text-xs"
            value={draft.platformPublicKey}
            onChange={event => update('platformPublicKey', event.target.value)}
          />
          <span className="block text-muted-foreground">复制易支付「个人资料 → API信息 → V2接口」的平台公钥，可直接粘贴不带头尾的内容。两项密钥均须为至少 2048 位 RSA。</span>
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isActive}
            disabled={draft.environment === 'TEST'}
            onChange={event => update('isActive', event.target.checked)}
          />
          作为唯一正式商户启用
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.refundsEnabled}
            onChange={event => update('refundsEnabled', event.target.checked)}
          />
          允许此版本执行退款（仍受服务器全局开关控制）
        </label>

        <label className="block space-y-1 text-sm">
          商户配置操作理由
          <input
            required
            maxLength={300}
            className="min-h-11 w-full rounded-lg border bg-background px-3"
            value={draft.reason}
            onChange={event => update('reason', event.target.value)}
          />
        </label>

        <p className="text-xs text-muted-foreground">
          保存只验证 RSA 密钥格式，不验证渠道账号是否开通，也不会连接渠道或创建真实支付。测试环境仅允许本机模拟 provider。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="min-h-11 rounded-lg border px-4" onClick={onCancel}>取消</button>
          <button
            disabled={busy || !canManage || (!canManageSecrets && !draft.id)}
            className="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground"
          >
            {busy ? '处理中…' : '保存并生成版本'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PaymentMerchantManagement() {
  const {token, permissions, loading} = useAdminAccess();
  const [rows, setRows] = useState<Merchant[]>([]);
  const [draft, setDraft] = useState<MerchantDraft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = permissions.includes('payments.merchants.manage');
  const canManageSecrets = permissions.includes('payments.merchants.secrets.manage');
  const canTest = permissions.includes('payments.merchants.test');

  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch('/api/admin/payments/merchants', {
      headers: {Authorization: `Bearer ${token}`},
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    setRows(data);
  }, [token]);

  useEffect(() => {
    let active = true;
    if (token) {
      void load().catch(loadError => {
        if (active) setError(loadError.message);
      });
    }
    return () => {
      active = false;
    };
  }, [token, load]);

  async function saveMerchant(value: MerchantDraft) {
    if (!token) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/payments/merchants', {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(value),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);

      setDraft(null);
      if (data.legacyOrdersPreservedBySnapshot === true) {
        setNotice('商户配置已保存；旧环境配置已加密留存，旧订单继续引用历史凭据。');
      } else if (data.legacyOrdersPreservedBySnapshot === false) {
        setNotice('商户配置已保存；旧订单仍依赖服务器环境配置，请在旧订单结清前保留原环境密钥。');
      } else {
        setNotice('商户配置已保存为新版本。');
      }
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }

  async function testMerchant(merchant: Merchant) {
    if (!token) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/admin/payments/merchants/${encodeURIComponent(merchant.id)}/test`,
        {method: 'POST', headers: {Authorization: `Bearer ${token}`}},
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setNotice(data.credentialsValid
        ? '凭据格式检查通过；未连接支付渠道，也未创建真实支付。'
        : '凭据无法解密或 RSA 密钥格式无效；未连接支付渠道。');
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '检查失败。');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="p-4"><p role="status">正在验证管理权限…</p></main>;
  }
  if (!token || !permissions.includes('payments.merchants.read')) {
    return <main className="p-4"><p role="alert">当前账号没有支付商户查看权限。</p></main>;
  }

  return (
    <main className="space-y-5 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">支付商户</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            密钥采用独立加密主密钥保存；每次保存生成不可变配置版本，新订单固定引用对应版本。
          </p>
        </div>
        {canManage && canManageSecrets && (
          <button
            className="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground"
            onClick={() => setDraft(newDraft())}
          >
            新增商户配置
          </button>
        )}
      </header>

      <CheckoutSettings token={token} canManage={canManage} />
      {error && <p role="alert" className="rounded-lg border border-red-500/40 p-3 text-red-400">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-500/40 p-3">{notice}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map(merchant => (
          <article key={merchant.id} className="min-w-0 space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{merchant.name}</h2>
              <span className="rounded-full border px-2 py-1 text-xs">
                {merchant.environment === 'PRODUCTION' ? '正式环境' : '本机模拟环境'}
                {' · '}
                {merchant.isActive ? '已启用' : '已停用'}
              </span>
            </div>
            <div className="break-all text-sm text-muted-foreground">
              <p>商户号：{merchant.currentRevision?.merchantNo ?? '尚未配置'}</p>
              <p>渠道：EZFP · 配置版本：{merchant.currentRevision?.revision ?? '无'}</p>
              <p>服务地址：{merchant.currentRevision?.apiBaseUrl ?? '无'}</p>
              <p>
                凭据：{merchant.currentRevision?.hasMerchantPrivateKey ? '商户私钥已加密' : '缺失'}
                {' / '}
                {merchant.currentRevision?.hasPlatformPublicKey ? '平台公钥已加密' : '缺失'}
                {' · 退款：'}
                {merchant.currentRevision?.refundsEnabled ? '已启用' : '关闭'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <button
                  className="min-h-10 rounded-lg border px-3"
                  onClick={() => setDraft(draftFromMerchant(merchant))}
                >
                  编辑 / 新版本
                </button>
              )}
              {canTest && (
                <button
                  className="min-h-10 rounded-lg border px-3"
                  disabled={busy}
                  onClick={() => void testMerchant(merchant)}
                >
                  验证本地密钥
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border p-5 text-sm text-muted-foreground">
          尚无后台商户配置。环境变量配置仍支持旧订单；新订单只有在后台正式商户启用并通过服务器支付开关后才会使用该渠道。
        </p>
      )}

      {draft && (
        <MerchantForm
          key={draft.id ?? 'new'}
          initial={draft}
          canManage={canManage}
          canManageSecrets={canManageSecrets}
          busy={busy}
          onCancel={() => setDraft(null)}
          onSave={saveMerchant}
        />
      )}
    </main>
  );
}

