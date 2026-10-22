'use client';

import {useCallback, useEffect, useState} from 'react';
import {Plus} from 'lucide-react';
import {AdminNotice, AdminPanel} from '@/components/admin/admin-page';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {CheckoutSettings} from '@/components/admin/payments/checkout-settings';
import {MerchantCard} from '@/components/admin/payments/merchant-card';
import {MerchantForm} from '@/components/admin/payments/merchant-form';
import {draftFromMerchant, newDraft, type Merchant, type MerchantDraft} from '@/components/admin/payments/merchant-types';

/**
 * 「商户」标签（V3 表 14：商户是财务支付的标签之一）。
 *
 * 与 /admin/payments/merchants 同源同接口，复用同一套卡片与表单；
 * 差别只在版式 —— 这里嵌在财务支付的标签里，不重复输出页面标题与 <main>。
 */
export function FinanceMerchants({token, permissions}: {token: string; permissions: string[]}) {
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
    setRows(await apiFetch<Merchant[]>(API.admin.payments.merchants, {token, cache: 'no-store'}));
  }, [token]);

  useEffect(() => {
    let active = true;
    if (token) {
      void load().catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : '读取商户配置失败。');
      });
    }
    return () => {
      active = false;
    };
  }, [token, load]);

  async function saveMerchant(value: MerchantDraft) {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiFetch<{legacyOrdersPreservedBySnapshot?: boolean | null}>(API.admin.payments.merchants, {token, method: 'POST', body: value});
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
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiFetch<{credentialsValid: boolean}>(API.admin.payments.testMerchant(merchant.id), {token, method: 'POST'});
      setNotice(data.credentialsValid
        ? '凭据格式检查通过；未连接支付渠道，也未创建真实支付。'
        : '凭据无法解密或 RSA 密钥格式无效；未连接支付渠道。');
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '检查失败。');
    } finally {
      setBusy(false);
    }
  }

  if (!permissions.includes('payments.merchants.read')) {
    return <AdminNotice tone="denied" title="当前账号没有支付商户查看权限。" />;
  }

  return (
    <>
      <AdminPanel title="支付商户" description="密钥采用独立加密主密钥保存；每次保存生成不可变配置版本，新订单固定引用对应版本。" actions={canManage && canManageSecrets && (
        <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setDraft(newDraft())}>新增商户配置</Button>
      )}>
        <div className="space-y-4">
          <CheckoutSettings token={token} canManage={canManage} />
          {error && <AdminNotice tone="error" title={error} />}
          {notice && <AdminNotice tone="success" title={notice} />}
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map(merchant => (
              <MerchantCard
                key={merchant.id}
                merchant={merchant}
                canManage={canManage}
                canTest={canTest}
                busy={busy}
                onEdit={() => setDraft(draftFromMerchant(merchant))}
                onTest={() => void testMerchant(merchant)}
              />
            ))}
          </div>
          {rows.length === 0 && (
            <AdminNotice tone="info" title="尚无后台商户配置" description="环境变量配置仍支持旧订单；新订单只有在后台正式商户启用并通过服务器支付开关后才会使用该渠道。" />
          )}
        </div>
      </AdminPanel>

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? '编辑商户并生成新版本' : '新增商户'}
        description="密钥独立加密保存，每次保存生成不可变配置版本。"
        size="lg"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>取消</Button>
            <Button type="submit" form="merchant-form" loading={busy} disabled={busy || !canManage || (!canManageSecrets && !draft?.id)}>保存并生成版本</Button>
          </>
        }
      >
        {draft && <MerchantForm key={draft.id ?? 'new'} initial={draft} canManageSecrets={canManageSecrets} onSave={saveMerchant} />}
      </Dialog>
    </>
  );
}
