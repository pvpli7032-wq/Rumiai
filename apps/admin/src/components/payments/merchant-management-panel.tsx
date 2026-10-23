'use client';

import {useCallback, useEffect, useState} from 'react';
import {Plus} from 'lucide-react';
import {AdminNotice, AdminPanel} from '@admin/components/admin-page';
import {Button} from '@rumiai/ui/button';
import {Dialog} from '@rumiai/ui/dialog';
import {apiFetch} from '@admin/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {CheckoutSettings} from './checkout-settings';
import {MerchantCard} from './merchant-card';
import {MerchantForm} from './merchant-form';
import {draftFromMerchant, newDraft, type Merchant, type MerchantDraft} from './merchant-types';

/** Shared merchant controller/presentation used by the embedded and standalone routes. */
export function MerchantManagementPanel({sessionActive, permissions, embedded = false}: {sessionActive: boolean; permissions: string[]; embedded?: boolean}) {
  const [rows, setRows] = useState<Merchant[]>([]);
  const [draft, setDraft] = useState<MerchantDraft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = permissions.includes('payments.merchants.manage');
  const canManageSecrets = permissions.includes('payments.merchants.secrets.manage');
  const canTest = permissions.includes('payments.merchants.test');

  const canRead = permissions.includes('payments.merchants.read');
  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await apiFetch<Merchant[]>(API.admin.payments.merchants, {credentials: 'same-origin', cache: 'no-store', signal});
    if (signal?.aborted) return;
    setRows(next); setLoaded(true);
  }, [sessionActive]);

  useEffect(() => {
    setLoaded(false); setRows([]); setError('');
    if (!sessionActive || !canRead) return;
    const controller = new AbortController();
    void load(controller.signal).catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : '读取商户配置失败。'); });
    return () => controller.abort();
  }, [sessionActive, canRead, load]);

  async function saveMerchant(value: MerchantDraft) {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiFetch<{legacyOrdersPreservedBySnapshot?: boolean | null}>(API.admin.payments.merchants, {credentials: 'same-origin', method: 'POST', body: value});
      setDraft(null);
      setNotice(data.legacyOrdersPreservedBySnapshot === true
        ? '商户配置已保存；旧环境配置已加密留存，旧订单继续引用历史凭据。'
        : data.legacyOrdersPreservedBySnapshot === false
          ? '商户配置已保存；旧订单仍依赖服务器环境配置，请在旧订单结清前保留原环境密钥。'
          : '商户配置已保存为新版本。');
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : '保存失败。'); }
    finally { setBusy(false); }
  }

  async function testMerchant(merchant: Merchant) {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiFetch<{credentialsValid: boolean}>(API.admin.payments.testMerchant(merchant.id), {credentials: 'same-origin', method: 'POST'});
      setNotice(data.credentialsValid ? '凭据格式检查通过；未连接支付渠道，也未创建真实支付。' : '凭据无法解密或 RSA 密钥格式无效；未连接支付渠道。');
    } catch (value) { setError(value instanceof Error ? value.message : '检查失败。'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <AdminNotice tone="denied" title="当前账号没有支付商户查看权限。" />;

  const content = (
    <>
      <CheckoutSettings sessionActive={sessionActive} canManage={canManage} />
      {error && <AdminNotice tone="error" title={error} />}
      {notice && <AdminNotice tone="success" title={notice} />}
      {!loaded && !error && <AdminNotice tone="loading" title="正在读取商户配置…" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(merchant => <MerchantCard key={merchant.id} merchant={merchant} canManage={canManage} canTest={canTest} busy={busy} onEdit={() => setDraft(draftFromMerchant(merchant))} onTest={() => void testMerchant(merchant)} />)}
      </div>
      {loaded && rows.length === 0 && <AdminNotice tone="info" title="尚无后台商户配置" description="环境变量配置仍支持旧订单；新订单只有在后台正式商户启用并通过服务器支付开关后才会使用该渠道。" />}
    </>
  );

  return (
    <>
      {embedded ? <AdminPanel title="支付商户" description="密钥采用独立加密主密钥保存；每次保存生成不可变配置版本，新订单固定引用对应版本。" actions={canManage && canManageSecrets && <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setDraft(newDraft())}>新增商户配置</Button>}>{content}</AdminPanel> : <div className="flex flex-col gap-5">{canManage && canManageSecrets && <div className="flex justify-end"><Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setDraft(newDraft())}>新增商户配置</Button></div>}{content}</div>}
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? '编辑商户并生成新版本' : '新增商户'} description="密钥独立加密保存，每次保存生成不可变配置版本。" size="lg" footer={<><Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>取消</Button><Button type="submit" form="merchant-form" loading={busy} disabled={busy || !canManage || (!canManageSecrets && !draft?.id)}>保存并生成版本</Button></>}>
        {draft && <MerchantForm key={draft.id ?? 'new'} initial={draft} canManageSecrets={canManageSecrets} onSave={saveMerchant} />}
      </Dialog>
    </>
  );
}
