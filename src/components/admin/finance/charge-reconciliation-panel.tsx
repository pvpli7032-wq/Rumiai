'use client';

import {ExternalLink, RefreshCw, ShieldCheck} from 'lucide-react';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';
import {AdminNotice, AdminPanel, AdminStat, AdminStatGrid} from '@/components/admin/admin-page';
import {DataTable} from '@/components/admin/layout/data-table';
import {FilterBar} from '@/components/admin/layout/filter-bar';
import type {TaskRunResult} from '@/components/admin/tasks/types';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Select} from '@/components/ui/select';
import type {AdminChargeItem, AdminChargePage, AdminChargeStatus} from '@/lib/admin/charges-admin';
import {apiFetch} from '@/lib/api-client';
import {API} from '@/lib/api-paths';

/**
 * 财务 · 异常核对（V3 §8 表 25）。
 *
 * 这里只做「看」和「触发既有核对任务」两件事。结算与释放的判定留在
 * src/lib/billing/recovery.ts 与 charge-service.ts，页面不复制一份状态机，
 * 否则同一条费用单会出现两套去留规则。
 */

const PAGE_LIMIT = 20;

const STATUS_FILTERS = [
  {value: 'HELD,UNKNOWN', label: '待核对（冻结 + 未知）'},
  {value: 'HELD', label: '仅冻结'},
  {value: 'UNKNOWN', label: '仅结果未知'},
  {value: 'SETTLED', label: '已结算'},
  {value: 'RELEASED', label: '已释放'},
];

const STATUS_LABELS: Record<AdminChargeStatus, string> = {
  HELD: '冻结中',
  UNKNOWN: '结果未知',
  SETTLED: '已结算',
  RELEASED: '已释放',
};

const STATUS_VARIANTS: Record<AdminChargeStatus, 'warning' | 'danger' | 'success' | 'neutral'> = {
  HELD: 'warning',
  UNKNOWN: 'danger',
  SETTLED: 'success',
  RELEASED: 'neutral',
};

const OPERATION_LABELS: Record<string, string> = {
  CHAT_SEND: '聊天消息',
  CHAT_REGENERATE: '重新生成',
  STORY_TURN: '剧情回合',
  MIRROR: '他眼中的你',
  DISPUTE_VERDICT: '评理裁决',
  MEMORY_SUMMARY: '记忆摘要',
};

/** 冻结/未知时长：分钟到天，超过一天不再显示分钟位。 */
function formatAge(minutes: number): string {
  if (minutes < 60) return minutes + ' 分钟';
  if (minutes < 1440) return Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分';
  return Math.floor(minutes / 1440) + ' 天 ' + Math.floor((minutes % 1440) / 60) + ' 小时';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false});
}

export function ChargeReconciliationPanel({sessionActive, canRun}: {sessionActive: boolean; canRun: boolean}) {
  const [status, setStatus] = useState('HELD,UNKNOWN');
  const [items, setItems] = useState<AdminChargeItem[]>([]);
  const [summary, setSummary] = useState<AdminChargePage['summary'] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const query = useCallback((nextCursor: string | null) => {
    const params = new URLSearchParams({status, limit: String(PAGE_LIMIT)});
    if (nextCursor) params.set('cursor', nextCursor);
    return params.toString();
  }, [status]);

  // 换筛选条件必须从第一页重新取：游标只在同一组状态内有效。
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setSummary(null);
    setError('');
    if (!sessionActive) return;
    const controller = new AbortController();
    setLoading(true);
    apiFetch<AdminChargePage>(API.admin.billingCharges(query(null)), {credentials: 'same-origin', signal: controller.signal, cache: 'no-store'})
      .then(data => {
        if (controller.signal.aborted) return;
        setItems(data.items);
        setSummary(data.summary);
        setCursor(data.nextCursor);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '费用单加载失败，请稍后重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionActive, query, refreshKey]);

  async function loadMore() {
    if (!sessionActive || !cursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const data = await apiFetch<AdminChargePage>(API.admin.billingCharges(query(cursor)), {credentials: 'same-origin', cache: 'no-store'});
      setItems(current => [...current, ...data.items]);
      setSummary(data.summary);
      setCursor(data.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '费用单加载失败，请稍后重试。');
    } finally {
      setLoadingMore(false);
    }
  }

  /** 恢复动作只调用既有后台任务，不在页面里另写结算/释放。 */
  async function runRecovery() {
    if (!sessionActive || running) return;
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch<TaskRunResult>(API.admin.taskRun('charge-recovery'), {credentials: 'same-origin', method: 'POST'});
      const failed = result.failed > 0 ? '，失败 ' + result.failed + ' 笔' : '';
      setNotice('计费核对已执行：' + result.detail + '（处理 ' + result.affected + ' 笔' + failed + '）。');
      setRefreshKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计费核对执行失败，请稍后重试。');
    } finally {
      setRunning(false);
    }
  }

  if (!sessionActive) return <AdminNotice tone="denied" title="请先登录财务管理员账号。" />;

  const emptyCopy = status === 'HELD,UNKNOWN' ? '当前没有需要人工核对的费用单' : '该状态下没有费用单';

  return (
    <>
      <AdminStatGrid className="xl:grid-cols-3">
        <AdminStat
          label="待结算笔数"
          value={String(summary?.held ?? 0)}
          hint="仍处于冻结、尚未结算或释放"
          tone={(summary?.held ?? 0) > 0 ? 'warning' : 'default'}
        />
        <AdminStat
          label="未知结果笔数"
          value={String(summary?.unknown ?? 0)}
          hint="超过两天没有权威结果，已挂账等人处理"
          tone={(summary?.unknown ?? 0) > 0 ? 'danger' : 'default'}
        />
        <AdminStat
          label="未知结果涉及币数"
          value={String(summary?.unknownCoins ?? 0)}
          hint="不盲目退款也不重发，按待核对金额挂账"
        />
      </AdminStatGrid>

      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {notice && <AdminNotice tone="success" title={notice} className="py-6" />}

      <AdminPanel
        title="异常核对"
        description="冻结超时与结果不明的费用单。核对只读库内已有记录，不重发模型请求、不改价格快照。"
        badge={<Badge variant={items.length > 0 ? 'warning' : 'success'}>{items.length} 条已加载</Badge>}
        actions={
          <>
            <Button variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>
              刷新
            </Button>
            {canRun && (
              <Button leadingIcon={<ShieldCheck className="h-4 w-4" />} loading={running} onClick={runRecovery}>
                立即核对一次
              </Button>
            )}
          </>
        }
        flush
        bodyClassName="p-5"
      >
        <DataTable
          rows={items}
          getRowId={item => item.id}
          loading={loading}
          filters={
            <FilterBar onReset={() => setStatus('HELD,UNKNOWN')} aria-label="费用单筛选">
              <div className="w-full sm:w-56">
                <Select aria-label="费用单状态" value={status} onChange={event => setStatus(event.target.value)}>
                  {STATUS_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
            </FilterBar>
          }
          empty={<p className="py-10 text-center text-sm text-muted-foreground">{emptyCopy}</p>}
          columns={[
            {
              id: 'user',
              header: '用户',
              cell: item => (
                <span className="block">
                  <span className="block font-medium">{item.userName}</span>
                  <span className="mt-0.5 block break-all text-xs text-muted-foreground">{item.userId}</span>
                </span>
              ),
            },
            {
              id: 'operation',
              header: '操作',
              cell: item => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm">{OPERATION_LABELS[item.operation] ?? item.operation}</span>
                  <Badge variant={STATUS_VARIANTS[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                  {item.allowanceSource === 'FREE_QUOTA' && <Badge variant="neutral">免费额度</Badge>}
                </span>
              ),
            },
            {id: 'coins', header: '币数', width: '80px', align: 'right', cell: item => <span className="tabular-nums">{item.coins}</span>},
            {id: 'heldAt', header: '创建时间', width: '130px', cell: item => <span className="whitespace-nowrap text-xs">{formatDateTime(item.heldAt)}</span>},
            {
              id: 'age',
              header: '已持有/未知时长',
              width: '150px',
              cell: item => <span className="whitespace-nowrap text-xs">{formatAge(item.ageMinutes)}</span>,
            },
            {
              id: 'link',
              header: '关联会话',
              width: '110px',
              cell: item => item.conversationId ? (
                <Link
                  href={'/chat?conversation=' + encodeURIComponent(item.conversationId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                >
                  打开会话
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              ) : <span className="text-xs text-muted-foreground">无</span>,
            },
          ]}
        />
        {cursor && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" loading={loadingMore} onClick={loadMore}>加载更多</Button>
          </div>
        )}
      </AdminPanel>
    </>
  );
}
