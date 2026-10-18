'use client';
import { AlertCircle, Check, Info } from 'lucide-react';

/** Field wrapper with label, optional hint tooltip and inline error slot. */
export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <label className="text-sm font-medium leading-none">
          {label}
          {required && <span className="ml-0.5 text-[#F2572B]">*</span>}
        </label>
        {hint && (
          <span title={hint} className="cursor-help text-muted-foreground transition-colors hover:text-foreground">
            <Info className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {children}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Character counter that warns before the limit is reached. */
export function Counter({ value, max }: { value: number; max: number }) {
  const ratio = value / max;
  const tone = ratio >= 1 ? 'text-red-500' : ratio > 0.9 ? 'text-amber-500' : 'text-muted-foreground';
  return (
    <p className={`mt-1 text-right text-xs tabular-nums ${tone}`}>
      {value.toLocaleString()}/{max.toLocaleString()}
    </p>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
        checked ? 'bg-[#F2572B]' : 'bg-input'
      }`}
    >
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** A row of tick-box style writing tips that light up as the text qualifies. */
export function Checklist({ items }: { items: { done: boolean; label: string }[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((it) => (
        <li key={it.label} className={`flex items-center gap-1.5 text-xs ${it.done ? 'text-emerald-500' : 'text-muted-foreground'}`}>
          <span
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
              it.done ? 'border-emerald-500 bg-emerald-500/15' : 'border-current opacity-50'
            }`}
          >
            {it.done && <Check className="h-2.5 w-2.5" />}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
