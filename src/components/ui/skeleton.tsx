import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export interface SkeletonProps extends ComponentPropsWithRef<'div'> {
  /** text: one line, circle: avatar, rect: block. Defaults to rect. */
  shape?: 'text' | 'circle' | 'rect';
}

export function Skeleton({ shape = 'rect', className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse bg-muted',
        shape === 'text' && 'h-4 w-full rounded',
        shape === 'circle' && 'h-10 w-10 rounded-full',
        shape === 'rect' && 'rounded-lg',
        className,
      )}
      {...props}
    />
  );
}

/** A block of placeholder lines, e.g. while a list loads. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} shape="text" className={index === lines - 1 ? 'w-2/3' : undefined} />
      ))}
    </div>
  );
}
