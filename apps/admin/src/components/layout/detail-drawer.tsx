'use client';

import type {ReactNode} from 'react';
import {Sheet} from '@rumiai/ui/sheet';
import {cn} from '@rumiai/ui/cn';

/**
 * 详情抽屉：列表里点一行就地看详情，不离开列表（V3 §15）。
 * 手机端由 Sheet 自带的整宽侧滑承担，内容区可滚动，底部动作固定。
 */
export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const WIDTHS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
} as const;

export function DetailDrawer({open, onClose, title, description, children, footer, size = 'md'}: DetailDrawerProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={footer}
      className={WIDTHS[size]}
    >
      {children}
    </Sheet>
  );
}

/** 抽屉内的一节：小标题 + 内容，节与节之间留统一间距。 */
export function DetailSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
      {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

/** 「名称：值」一行，详情里反复出现，宽度不足时自动换行而不是溢出。 */
export function DetailRow({label, children}: {label: ReactNode; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-3">
      <span className="shrink-0 text-muted-foreground sm:w-28">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}
