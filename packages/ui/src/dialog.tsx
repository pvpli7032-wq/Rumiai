'use client';

import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { useOverlayDismiss } from './overlay';
import { Portal } from './portal';

const sizes = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[calc(100vw-2rem)]',
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof sizes;
  /** Clicking the backdrop closes the dialog. Defaults to true. */
  closeOnOverlayClick?: boolean;
  hideCloseButton?: boolean;
  className?: string;
}

/**
 * Modal dialog. On phones it docks to the bottom of the screen; from sm upwards it
 * centres. Renders nothing while closed, so callers can mount it unconditionally.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlayClick = true,
  hideCloseButton = false,
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  useOverlayDismiss(open, onClose);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <div
          aria-hidden
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={closeOnOverlayClick ? onClose : undefined}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            'relative z-10 flex max-h-[calc(var(--app-height,100dvh)-1rem)] w-full flex-col overflow-hidden',
            'rounded-t-2xl border border-border bg-card text-card-foreground shadow-xl sm:max-h-[calc(var(--app-height,100dvh)-2rem)] sm:rounded-2xl',
            sizes[size],
            className,
          )}
        >
          {(title || description || !hideCloseButton) && (
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="min-w-0 flex-1">
                {title && <h2 id={titleId} className="text-base font-semibold leading-tight">{title}</h2>}
                {description && <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
              {!hideCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  className="-m-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
