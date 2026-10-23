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
          <div role="list" aria-label="每日有效回复" className="flex h-40 items-end gap-1 sm:gap-2">
            {points.map(point => (
              <div key={point.date} role="listitem" className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-muted-foreground">{point.value}</span>
                <div
                  aria-hidden
                  className="w-full rounded-t bg-brand/70"
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
