'use client';

import {useState, type FormEvent} from 'react';
import {Input} from '@rumiai/ui/input';
import {Select} from '@rumiai/ui/select';
import {Textarea} from '@rumiai/ui/textarea';
import {ENVIRONMENT_BASE_URL, type MerchantDraft} from './merchant-types';

/** 商户配置表单：新建与编辑共用，编辑时密钥留空表示沿用当前版本。 */

type MerchantFormProps = {
  initial: MerchantDraft;
  canManageSecrets: boolean;
  onSave: (draft: MerchantDraft) => Promise<void>;
};

export function MerchantForm({initial, canManageSecrets, onSave}: MerchantFormProps) {
  const [draft, setDraft] = useState(initial);

  function update<K extends keyof MerchantDraft>(key: K, value: MerchantDraft[K]) {
    setDraft(current => ({...current, [key]: value}));
  }

  function changeEnvironment(environment: MerchantDraft['environment']) {
    setDraft(current => ({
      ...current,
      environment,
      apiBaseUrl: ENVIRONMENT_BASE_URL[environment],
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
