'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {ChevronRight, LayoutGrid, Scale, Users, type LucideIcon} from 'lucide-react';
import {api} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {useUiConfig} from '@/lib/settings/use-ui-config';

/**
 * 广场（V3 §19）：主导航的第四项，聚合「圈子动态」与「评理广场」两个内容入口。
 *
 * 卡片不写死可达性：开关关掉的玩法保留卡片但标「暂未开放」，不给链接，
 * 免得点进去是 404 或一句 403。开关值只读 /api/ui-config（PUBLIC_KEYS 白名单里的
 * dispute.enabled），前端不另写一份默认值。
 */

interface EntryStatus {
  /** 圈子总数；null 表示还没读到。 */
  circles: number | null;
  /** 评理是否有进行中的案例；null 表示还没读到或没开。 */
  disputeLive: boolean | null;
}

function SquareCard({icon: Icon, title, description, status, href, disabledNote}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: string | null;
  href: string;
  /** 有值即为关闭态：不渲染链接，只显示这句「暂未开放」。 */
  disabledNote?: string;
}) {
  const body = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold">{title}</span>
          {disabledNote && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{disabledNote}</span>
          )}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
        {status && <span className="mt-1 block text-xs text-brand">{status}</span>}
      </span>
      {!disabledNote && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );

  if (disabledNote) {
    return (
      <div aria-disabled="true" className="flex items-center gap-3 rounded-xl border border-border p-4 opacity-70">
        {body}
      </div>
    );
  }
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:border-brand/60">
      {body}
    </Link>
  );
}

export default function SquarePage() {
  const config = useUiConfig();
  // 配置未加载（hook 首帧返回空对象）与配置明确关闭要分开说：
  // 前者只是还没读到，标「正在读取」；后者才是「暂未开放」。两种情况都不给链接。
  const configLoaded = Object.keys(config).length > 0;
  const disputeEnabled = config['dispute.enabled'] === true;
  const disputeNote = !configLoaded ? '正在读取…' : disputeEnabled ? undefined : '暂未开放';

  const [status, setStatus] = useState<EntryStatus>({circles: null, disputeLive: null});

  useEffect(() => {
    const controller = new AbortController();
    void api
      .get<unknown>(API.circles.list, {signal: controller.signal})
      .then(rows => {
        if (!controller.signal.aborted) setStatus(current => ({...current, circles: Array.isArray(rows) ? rows.length : 0}));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // 关掉的玩法不必再拉列表；开关读到了才请求。
  useEffect(() => {
    if (!disputeEnabled) return;
    const controller = new AbortController();
    void api
      .get<{items?: unknown[]}>(API.disputes.list('sort=latest&limit=1'), {signal: controller.signal})
      .then(page => {
        if (!controller.signal.aborted) setStatus(current => ({...current, disputeLive: (page.items?.length ?? 0) > 0}));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [disputeEnabled]);

  const circlesStatus = status.circles === null
    ? '正在读取…'
    : status.circles === 0 ? '还没有圈子，来创建第一个' : `${status.circles} 个圈子可逛`;
  const disputeStatus = disputeEnabled
    ? (status.disputeLive === null ? '正在读取…' : status.disputeLive ? '有新案例，等你投票' : '暂无进行中的案例')
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <LayoutGrid className="h-6 w-6" aria-hidden="true" />
          广场
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">圈子聊兴趣，评理讲道理。</p>
      </header>

      <div className="space-y-3">
        <SquareCard
          icon={Users}
          title="圈子动态"
          description="按兴趣加入圈子，发帖、评论、找同好"
          status={circlesStatus}
          href="/circles"
        />
        <SquareCard
          icon={Scale}
          title="评理广场"
          description="从聊天里摘出片段，说清诉求，让大家投票谁更有理"
          status={disputeStatus}
          href="/disputes"
          disabledNote={disputeNote}
        />
      </div>
    </main>
  );
}
