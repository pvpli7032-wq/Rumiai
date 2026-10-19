'use client';

import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Plus} from 'lucide-react';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Select} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
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

function MerchantForm({initial, canManage, canManageSecrets, onSave}: MerchantFormProps) {
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
    <form id="merchant-form" onSubmit={submit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">商户名称</span>
        <Input required maxLength={60} value={draft.name} onChange={event => update('name', event.target.value)} />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">环境</span>
        <Select aria-label="环境" value={draft.environment} onChange={event => changeEnvironment(event.target.value as MerchantDraft['environment'])}>
          <option value="TEST">本机模拟</option>
          <option value="PRODUCTION">正式 EZFP</option>
        </Select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">商户编号</span>
        <Input required maxLength={30} inputMode="numeric" value={draft.merchantNo} onChange={event => update('merchantNo', event.target.value)} />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">API Base URL</span>
        <Input required readOnly className="bg-muted" value={draft.apiBaseUrl} />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">商户 RSA 私钥{draft.id && <span className="text-muted-foreground">（留空沿用当前版本）</span>}</span>
        <Textarea
          rows={4}
          required={!draft.id}
          disabled={!canManageSecrets}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          value={draft.merchantPrivateKey}
          onChange={event => update('merchantPrivateKey', event.target.value)}
        />
        <span className="block text-xs text-muted-foreground">填写生成 RSA 密钥对时保存的商户私钥，不是商户公钥或 MD5 密钥。支持 PEM 和不带头尾的 Base64。</span>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">支付平台 RSA 公钥{draft.id && <span className="text-muted-foreground">（留空沿用当前版本）</span>}</span>
        <Textarea
          rows={4}
          required={!draft.id}
          disabled={!canManageSecrets}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          value={draft.platformPublicKey}
          onChange={event => update('platformPublicKey', event.target.value)}
        />
        <span className="block text-xs text-muted-foreground">复制易支付「个人资料 → API信息 → V2接口」的平台公钥，可直接粘贴不带头尾的内容。两项密钥均须为至少 2048 位 RSA。</span>
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} disabled={draft.environment === 'TEST'} onChange={event => update('isActive', event.target.checked)} />
        作为唯一正式商户启用
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.refundsEnabled} onChange={event => update('refundsEnabled', event.target.checked)} />
        允许此版本执行退款（仍受服务器全局开关控制）
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">商户配置操作理由</span>
        <Input required maxLength={300} value={draft.reason} onChange={event => update('reason', event.target.value)} />
      </label>

      <p className="text-xs text-muted-foreground">
        保存只验证 RSA 密钥格式，不验证渠道账号是否开通，也不会连接渠道或创建真实支付。测试环境仅允许本机模拟 provider。
      </p>
    </form>
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
    return <AdminPage><AdminNotice tone="loading" title="正在验证管理权限…" /></AdminPage>;
  }
  if (!token || !permissions.includes('payments.merchants.read')) {
    return <AdminPage><AdminNotice tone="denied" title="当前账号没有支付商户查看权限。" /></AdminPage>;
  }

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="财务与支付"
        title="支付商户"
        description="密钥采用独立加密主密钥保存；每次保存生成不可变配置版本，新订单固定引用对应版本。"
        actions={canManage && canManageSecrets && <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setDraft(newDraft())}>新增商户配置</Button>}
      />

      <CheckoutSettings token={token} canManage={canManage} />
      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(merchant => (
          <article key={merchant.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{merchant.name}</h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={merchant.environment === 'PRODUCTION' ? 'brand' : 'neutral'}>{merchant.environment === 'PRODUCTION' ? '正式环境' : '本机模拟环境'}</Badge>
                <Badge variant={merchant.isActive ? 'success' : 'neutral'}>{merchant.isActive ? '已启用' : '已停用'}</Badge>
              </div>
            </div>
            <div className="space-y-1 break-all text-sm text-muted-foreground">
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
              {canManage && <Button size="sm" variant="outline" onClick={() => setDraft(draftFromMerchant(merchant))}>编辑 / 新版本</Button>}
              {canTest && <Button size="sm" variant="outline" disabled={busy} onClick={() => void testMerchant(merchant)}>验证本地密钥</Button>}
            </div>
          </article>
        ))}
      </div>

      {rows.length === 0 && (
        <AdminNotice
          tone="info"
          title="尚无后台商户配置"
          description="环境变量配置仍支持旧订单；新订单只有在后台正式商户启用并通过服务器支付开关后才会使用该渠道。"
        />
      )}

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? '编辑商户并生成新版本' : '新增商户'}
        description="密钥独立加密保存，每次保存生成不可变配置版本。"
        size="lg"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>取消</Button>
            <Button
              type="submit"
              form="merchant-form"
              loading={busy}
              disabled={busy || !canManage || (!canManageSecrets && !draft?.id)}
            >
              保存并生成版本
            </Button>
          </>
        }
      >
        {draft && (
          <MerchantForm
            key={draft.id ?? 'new'}
            initial={draft}
            canManage={canManage}
            canManageSecrets={canManageSecrets}
            onSave={saveMerchant}
          />
        )}
      </Dialog>
    </AdminPage>
  );
}

