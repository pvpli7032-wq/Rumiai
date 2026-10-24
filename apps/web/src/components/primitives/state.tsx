import { CheckCircle2, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@rumiai/ui/empty-state';
import { ErrorState } from '@rumiai/ui/error-state';
import { SkeletonText } from '@rumiai/ui/skeleton';
import { cn } from '@rumiai/ui/cn';

export type StateKind = 'loading' | 'empty' | 'error' | 'success';

export interface StateProps {
  kind: StateKind;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Shared state presentation. It never fetches, retries, or owns business state. */
export function State({ kind, title, description, action, className }: StateProps) {
  if (kind === 'loading') {
    return (
      <div className={cn('web-state web-card border border-border bg-card', className)} role="status" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          <span>{title ?? '加载中'}</span>
        </div>
        <SkeletonText lines={2} className="mt-4" />
      </div>
    );
  }
  if (kind === 'empty') {
    return <EmptyState icon={<Inbox className="h-6 w-6" />} title={title ?? '暂无内容'} description={description} action={action} className={cn('web-card', className)} />;
  }
  if (kind === 'error') {
    return <ErrorState title={title ?? '加载失败'} description={description} action={action} className={cn('web-card', className)} />;
  }
  return (
    <div className={cn('web-card flex items-start gap-3 border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-foreground', className)} role="status">
      <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
      <div>
        <p className="font-medium">{title ?? '已完成'}</p>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
