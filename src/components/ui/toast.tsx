'use client';

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { Portal } from './portal';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. 0 keeps the toast until dismissed. Defaults to 4000. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  /** Show a toast; returns its id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, string> = {
  default: 'border-border bg-card text-card-foreground',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-foreground',
  warning: 'border-amber-500/40 bg-amber-500/10 text-foreground',
  danger: 'border-destructive/40 bg-destructive/10 text-foreground',
};

const variantIcons: Record<ToastVariant, ReactNode> = {
  default: <Info aria-hidden className="h-4 w-4 text-muted-foreground" />,
  success: <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-500" />,
  warning: <AlertCircle aria-hidden className="h-4 w-4 text-amber-500" />,
  danger: <AlertCircle aria-hidden className="h-4 w-4 text-destructive" />,
};

/**
 * Holds the toast queue and renders it in a fixed viewport. Wrap the app once, then
 * call useToast() from any client component below it.
 */
export function ToastProvider({ children, max = 4 }: { children: ReactNode; max?: number }) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const duration = options.duration ?? 4000;
      setItems((current) => [...current, { ...options, id }].slice(-max));
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss, max],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const context = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={context}>
      {children}
      <Portal>
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        >
          {items.map((item) => (
            <div
              key={item.id}
              role="status"
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-4 py-3 shadow-lg',
                variantStyles[item.variant ?? 'default'],
              )}
            >
              <span className="mt-0.5">{variantIcons[item.variant ?? 'default']}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                {item.description && <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>}
              </div>
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => dismiss(item.id)}
                className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast() must be used inside <ToastProvider>');
  return context;
}
