'use client';

import Link from 'next/link';
import type {ReactNode} from 'react';
import {Coins, Cpu, MessageSquare, UserPlus} from 'lucide-react';
import {AdminStat} from '@admin/components/admin-page';
import {cn} from '@rumiai/ui/cn';
import {cnyText, metricText} from './formatters';
import {rangeToDayParams, type RangeDays} from './range';
import type {WorkbenchData} from './types';

/** 卡片本体在悬停时提亮边框；链接负责键盘焦点环与 title 提示。 */
const CARD = 'transition-colors group-hover:border-brand/60 group-hover:bg-brand-soft/30';

/**
 * 第一行四指标：新增用户、有效回复、实收金额、AI 成本（V3 §14）。
 *
 * 每张卡都是链接，把工作台当前的日期范围带到目标列表（V3 §14「点击指标进入对应列表
 * 并保留筛选日期」）。目标列表必须真的按 from/until 过滤，否则这里就不该给链接。
 */
export function MetricCards({data, range}: {data: WorkbenchData; range: RangeDays}) {
  const {from, until} = rangeToDayParams(range);
  const dayQuery = `from=${from}&until=${until}`;

  /**
   * 有效回复没有独立的消息列表：后台唯一的「有效回复」出处是运营分析页，
   * 它自己就按 days 统计（含每日明细），所以跳那里并把同一档天数带过去最贴切。
   */
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <MetricLink href={`/admin/accounts?${dayQuery}`} title={`查看 ${from} 至 ${until} 注册的用户列表`}>
        <AdminStat label="新增用户" value={metricText(data.newUsers)} hint={data.newUsers.hint} icon={<UserPlus className="h-4 w-4" />} tone="brand" className={CARD} />
      </MetricLink>
      <MetricLink href={`/admin/analytics?days=${range}`} title={`查看最近 ${range} 天的运营分析`}>
        <AdminStat label="有效回复" value={metricText(data.validReplies)} hint={data.validReplies.hint} icon={<MessageSquare className="h-4 w-4" />} tone="brand" className={CARD} />
      </MetricLink>
      <MetricLink href={`/admin/finance?${dayQuery}`} title={`查看 ${from} 至 ${until} 的充值订单`}>
        <AdminStat label="实收金额" value={cnyText(data.paidAmountCnyCents)} hint={data.paidAmountCnyCents.hint} icon={<Coins className="h-4 w-4" />} tone="success" className={CARD} />
      </MetricLink>
      <MetricLink href={`/admin/ai/costs?days=${range}`} title={`查看最近 ${range} 天的 AI 成本`}>
        <AdminStat
          label="AI 成本"
          value={data.aiCost.value === null ? <span className="text-base font-medium">{data.aiCost.unavailableReason ?? '暂无数据'}</span> : metricText(data.aiCost)}
          hint={data.aiCost.hint}
          icon={<Cpu className="h-4 w-4" />}
          tone={data.aiCost.value === null ? 'warning' : 'default'}
          className={cn(CARD, data.aiCost.value === null && 'border-amber-500/40 bg-amber-500/5')}
        />
      </MetricLink>
    </div>
  );
}

function MetricLink({href, title, children}: {href: string; title: string; children: ReactNode}) {
  return (
    <Link
      href={href}
      title={title}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </Link>
  );
}
