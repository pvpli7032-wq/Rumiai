'use client';

import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { useOverlayDismiss } from './overlay';
import { Portal } from './portal';

const sides = {
  right: 'inset-y-0 right-0 h-full w-full max-w-sm border-l',
  left: 'inset-y-0 left-0 h-full w-full max-w-sm border-r',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] w-full border-t rounded-t-2xl',
  top: 'inset-x-0 top-0 max-h-[85dvh] w-full border-b rounded-b-2xl',
};

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: keyof typeof sides;
  closeOnOverlayClick?: boolean;
  hideCloseButton?: boolean;
  className?: string;
}

/** Slide-over panel anchored to one edge of the screen. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  closeOnOverlayClick = true,
  hideCloseButton = false,
  className,
}: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  useOverlayDismiss(open, onClose);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50">
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
            'absolute flex flex-col overflow-hidden border-border bg-card text-card-foreground shadow-xl',
            sides[side],
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
