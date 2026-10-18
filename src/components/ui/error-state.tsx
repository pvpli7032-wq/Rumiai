import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ErrorStateProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Usually a retry <Button>. */
  action?: ReactNode;
  className?: string;
}

/** Inline failure panel. Announced as an alert so screen readers pick it up. */
export function ErrorState({ title = '加载失败', description, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center',
        className,
      )}
    >
      <AlertCircle aria-hidden className="h-6 w-6 text-destructive" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
