'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Page buttons kept on each side of the current page. Defaults to 1. */
  siblingCount?: number;
  disabled?: boolean;
  /** Optional "共 N 条" style text shown on the left. */
  summary?: ReactNode;
  className?: string;
}

type PageItem = number | 'ellipsis';

function pageItems(page: number, pageCount: number, siblingCount: number): PageItem[] {
  const visible = 5 + siblingCount * 2;
  if (pageCount <= visible) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const left = Math.max(page - siblingCount, 2);
  const right = Math.min(page + siblingCount, pageCount - 1);
  const items: PageItem[] = [1];
  if (left > 2) items.push('ellipsis');
  for (let current = left; current <= right; current += 1) items.push(current);
  if (right < pageCount - 1) items.push('ellipsis');
  items.push(pageCount);
  return items;
}

const buttonBase =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/** Page switcher. The caller owns the page state and the data fetching. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  disabled = false,
  summary,
  className,
}: PaginationProps) {
  const safePageCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), safePageCount);

  return (
    <nav aria-label="分页" className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <span className="text-sm text-muted-foreground">{summary}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="上一页"
          className={cn(buttonBase, 'text-foreground hover:bg-muted')}
          disabled={disabled || current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        {pageItems(current, safePageCount, siblingCount).map((item, index) =>
          item === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} aria-hidden className="px-1 text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`第 ${item} 页`}
              aria-current={item === current ? 'page' : undefined}
              className={cn(buttonBase, item === current ? 'bg-brand text-brand-foreground' : 'text-foreground hover:bg-muted')}
              disabled={disabled}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="下一页"
          className={cn(buttonBase, 'text-foreground hover:bg-muted')}
          disabled={disabled || current >= safePageCount}
          onClick={() => onPageChange(current + 1)}
        >
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
