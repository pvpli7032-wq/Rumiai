import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@rumiai/ui/cn';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'error';

export interface ToastProps {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  onDismiss?: () => void;
  className?: string;
}

const toneClass: Record<ToastTone, string> = {
  neutral: 'border-border bg-card text-foreground',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-foreground',
  warning: 'border-amber-500/30 bg-amber-500/10 text-foreground',
  error: 'border-destructive/30 bg-destructive/10 text-foreground',
};

/** Presentational toast; the caller owns timing, persistence, and side effects. */
export function Toast({ title, description, tone = 'neutral', onDismiss, className }: ToastProps) {
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <div role={role} className={cn('web-toast web-card flex items-start gap-3 border text-sm', toneClass[tone], className)}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="关闭提示" className="web-control -m-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X aria-hidden className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
