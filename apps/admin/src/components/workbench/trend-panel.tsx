'use client';

import {AdminPanel} from '@admin/components/admin-page';
import {shortDate} from './formatters';
import type {TrendPoint} from './types';

/** 下方最多一张趋势图：每日有效回复。没有逐日数据就写「暂无数据」。 */
export function TrendPanel({points}: {points: TrendPoint[]}) {
  const max = points.reduce((value, point) => Math.max(value, point.value), 0);

  return (
    <AdminPanel title="每日有效回复" description="按自然日统计已保存的 AI 回复条数；失败与占位回复不计入。">
      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p>
      ) : (
        <div className="space-y-3">
          <div role="list" aria-label="每日有效回复" className="relative flex h-44 items-end gap-1 rounded-2xl border border-border/70 bg-muted/15 px-3 pb-3 pt-5 sm:gap-2">
            <span className="pointer-events-none absolute inset-x-3 top-1/3 border-t border-dashed border-border/70" />
            <span className="pointer-events-none absolute inset-x-3 top-2/3 border-t border-dashed border-border/70" />
            {points.map(point => (
              <div key={point.date} role="listitem" className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-muted-foreground">{point.value}</span>
                <div
                  aria-hidden
                  title={`${point.date}: ${point.value} 条有效回复`}
                  className="relative z-10 w-full rounded-t bg-brand transition-opacity hover:opacity-80"
                  style={{height: `${max > 0 ? Math.max(2, Math.round((point.value / max) * 120)) : 2}px`}}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{shortDate(points[0].date)}</span>
            <span>{shortDate(points[points.length - 1].date)}</span>
          </div>
        </div>
      )}
    </AdminPanel>
  );
}
