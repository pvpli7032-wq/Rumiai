'use client';

import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import type {Merchant} from './merchant-types';

/** 一条商户配置的卡片：环境、启用状态、当前版本与凭据概况，外加编辑与自检入口。 */
export function MerchantCard({merchant, canManage, canTest, busy, onEdit, onTest}: {
  merchant: Merchant;
  canManage: boolean;
  canTest: boolean;
  busy: boolean;
  onEdit: () => void;
  onTest: () => void;
}) {
  const revision = merchant.currentRevision;
  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{merchant.name}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={merchant.environment === 'PRODUCTION' ? 'brand' : 'neutral'}>{merchant.environment === 'PRODUCTION' ? '正式环境' : '本机模拟环境'}</Badge>
          <Badge variant={merchant.isActive ? 'success' : 'neutral'}>{merchant.isActive ? '已启用' : '已停用'}</Badge>
        </div>
      </div>
      <div className="space-y-1 break-all text-sm text-muted-foreground">
        <p>商户号：{revision?.merchantNo ?? '尚未配置'}</p>
        <p>渠道：EZFP · 配置版本：{revision?.revision ?? '无'}</p>
        <p>服务地址：{revision?.apiBaseUrl ?? '无'}</p>
        <p>
          凭据：{revision?.hasMerchantPrivateKey ? '商户私钥已加密' : '缺失'}
          {' / '}
          {revision?.hasPlatformPublicKey ? '平台公钥已加密' : '缺失'}
          {' · 退款：'}
          {revision?.refundsEnabled ? '已启用' : '关闭'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManage && <Button size="sm" variant="outline" onClick={onEdit}>编辑 / 新版本</Button>}
        {canTest && <Button size="sm" variant="outline" disabled={busy} onClick={onTest}>验证本地密钥</Button>}
      </div>
    </article>
  );
}
