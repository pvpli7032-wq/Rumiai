export type VariantMap = Record<string, Record<string, string>>;

/**
 * Minimal stand-in for class-variance-authority: one class string per variant key.
 * A missing or falsy prop falls back to the declared default.
 */
export function createVariants<M extends VariantMap>(
  map: M,
  defaults: Partial<Record<keyof M & string, string>> = {},
) {
  return (props: Partial<Record<keyof M & string, string | false | null | undefined>> = {}): string => {
    const classes: string[] = [];
    for (const key of Object.keys(map) as (keyof M & string)[]) {
      const value = props[key] || defaults[key];
      if (!value) continue;
      const group: Record<string, string> = map[key];
      const cls = group[String(value)];
      if (cls) classes.push(cls);
    }
    return classes.join(' ');
  };
}
