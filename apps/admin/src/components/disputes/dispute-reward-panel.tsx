'use client';

import {ArrowUpRight} from 'lucide-react';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {AdminNotice, AdminPanel} from '@admin/components/admin-page';
import {apiFetch} from '@admin/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {REWARD_SETTING_KEYS, REWARD_SETTING_LABELS, type RewardSettingKey} from './types';

/**
 * 评理奖励：只读展示当前生效的四个奖励键。
 *
 * V3 表 9「奖励在活动专页，次数在设置中心」——编辑位置只有设置中心「增长玩法」，
 * 这里不出现第二套输入框，只给数值与跳转。金额为 0 就是不发奖。
 */
export interface DisputeRewardPanelProps {
  sessionActive: boolean;
  canReadSettings: boolean;
  /** 案例列表刷新时一起重读，避免和列表数据不同步。 */
  refreshKey: number;
}

function readValue(values: Partial<Record<RewardSettingKey, unknown>>, key: RewardSettingKey): string {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

/** 只有金额键为 0 才意味着「不发奖」；名次数为 0 不会出现（下限是 1）。 */
function isNoPayout(key: RewardSettingKey, text: string): boolean {
  return text === '0' && (key === 'dispute.participateRewardCoins' || key === 'dispute.hotRewardCoins' || key === 'dispute.rewardDailyCapCoins');
}

export function DisputeRewardPanel({sessionActive, canReadSettings, refreshKey}: DisputeRewardPanelProps) {
  const [values, setValues] = useState<Partial<Record<RewardSettingKey, unknown>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 只读读取：没有设置查看权限就完全不发请求，也不显示猜测值。
  useEffect(() => {
    if (!sessionActive || !canReadSettings) { setValues(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void apiFetch<{values: {key: string; value: unknown}[]}>(API.admin.settings + '?group=growth', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal})
      .then(data => {
        if (controller.signal.aborted) return;
        const picked: Partial<Record<RewardSettingKey, unknown>> = {};
        for (const key of REWARD_SETTING_KEYS) {
          const row = data.values.find(item => item.key === key);
          if (row) picked[key] = row.value;
        }
        setValues(picked);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '奖励参数读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionActive, canReadSettings, refreshKey]);

  return (
    <AdminPanel
      title="奖励"
      description="参与奖在投票成功时发，热门奖在结案时按票数发；金额未填或为 0 就不发。"
      actions={
        <Link
          href="/admin/settings"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          去设置中心修改
          <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
      bodyClassName="p-5"
    >
      {!canReadSettings && (
        <AdminNotice tone="info" title="当前账号没有设置查看权限" description="奖励参数只在设置中心展示；这里给不出数值，也不会显示猜测值。" />
      )}
      {canReadSettings && error && <AdminNotice tone="error" title={error} />}
      {canReadSettings && !error && loading && <AdminNotice tone="loading" title="正在读取奖励参数…" />}
      {canReadSettings && !error && !loading && values && (
        <dl className="divide-y divide-border">
          {REWARD_SETTING_KEYS.map(key => (
            <div key={key} className="flex flex-col gap-0.5 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4">
              <dt className="shrink-0 text-muted-foreground sm:w-40">{REWARD_SETTING_LABELS[key].label}</dt>
              <dd className="min-w-0 break-words font-medium text-foreground">
                {readValue(values, key)} {REWARD_SETTING_LABELS[key].unit}
                {isNoPayout(key, readValue(values, key)) && <span className="ml-1.5 text-xs font-normal text-muted-foreground">不发</span>}
              </dd>
              <dd className="min-w-0 break-all text-xs text-muted-foreground sm:ml-auto">{key}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        每个业务键只发一次：参与奖按「案例 + 用户」，热门奖按「案例 + 用户」，重复结案与改票都不会重发。
        每日上限按 billing.dayTimezone 的业务日统计，超出部分按剩余额度截断。
      </p>
    </AdminPanel>
  );
}
