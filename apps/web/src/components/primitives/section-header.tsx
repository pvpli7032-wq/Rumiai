import type { ReactNode } from 'react';
import { cn } from '@rumiai/ui/cn';

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Web-only heading composition; callers own the action and its behaviour. */
export function SectionHeader({ title, description, action, className }: SectionHeaderProps) {
  return (
    <header className={cn('web-section-header flex items-start justify-between', className)}>
      <div className="min-w-0">
        <h2 className="web-section-title font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
