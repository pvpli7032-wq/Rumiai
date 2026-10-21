'use client';

import {Coins, Cpu, MessageSquare, UserPlus} from 'lucide-react';
import {AdminStat} from '@/components/admin/admin-page';
import {cn} from '@/components/ui/cn';
import {cnyText, metricText} from './formatters';
import type {WorkbenchData} from './types';

/** 第一行四指标：新增用户、有效回复、实收金额、AI 成本（V3 §14）。手机端两列。 */
export function MetricCards({data}: {data: WorkbenchData}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <AdminStat label="新增用户" value={metricText(data.newUsers)} hint={data.newUsers.hint} icon={<UserPlus className="h-4 w-4" />} tone="brand" />
      <AdminStat label="有效回复" value={metricText(data.validReplies)} hint={data.validReplies.hint} icon={<MessageSquare className="h-4 w-4" />} tone="brand" />
      <AdminStat label="实收金额" value={cnyText(data.paidAmountCnyCents)} hint={data.paidAmountCnyCents.hint} icon={<Coins className="h-4 w-4" />} tone="success" />
      <AdminStat
        label="AI 成本"
        value={data.aiCost.value === null ? <span className="text-base font-medium">{data.aiCost.unavailableReason ?? '暂无数据'}</span> : metricText(data.aiCost)}
        hint={data.aiCost.hint}
        icon={<Cpu className="h-4 w-4" />}
        tone={data.aiCost.value === null ? 'warning' : 'default'}
        className={cn(data.aiCost.value === null && 'border-amber-500/40 bg-amber-500/5')}
      />
    </div>
  );
}
