'use client';

import { useEffect, useRef } from 'react';

export interface OverlayDismissOptions {
  /** Close on the Escape key. Defaults to true. */
  closeOnEscape?: boolean;
  /** Freeze background scrolling while open. Defaults to true. */
  lockScroll?: boolean;
}

/**
 * Shared overlay behaviour for Dialog and Sheet: Escape to close, background scroll
 * lock, and focus returned to the trigger on close.
 */
export function useOverlayDismiss(open: boolean, onClose: () => void, options: OverlayDismissOptions = {}) {
  const { closeOnEscape = true, lockScroll = true } = options;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    if (lockScroll) document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (closeOnEscape && event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, closeOnEscape, lockScroll]);
}
