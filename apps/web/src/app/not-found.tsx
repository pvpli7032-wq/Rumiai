import Link from 'next/link';
import { DEFAULT_LOCALE, getDictionary } from '@web/lib/i18n';

/**
 * App Router 404. Without one, Next falls back to synthesising the Pages Router
 * /404 and /500, which is what the CI build was failing to prerender. A public site
 * with a large indexable surface also wants its own branded not-found page rather
 * than the framework default.
 */
export default function NotFound() {
  const dict = getDictionary(DEFAULT_LOCALE);

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <p className="text-6xl font-bold text-muted-foreground/40">404</p>
      <h1 className="text-xl font-semibold text-foreground">页面不存在</h1>
      <p className="max-w-sm text-muted-foreground">
        页面可能已移动或删除，请返回发现页。
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href={`/${DEFAULT_LOCALE}`}
          className="web-control rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {dict.chatNow}
        </Link>
        <Link
          href={`/${DEFAULT_LOCALE}/explore`}
          className="web-control rounded-full border border-border px-6 py-2.5 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {dict.charactersSection}
        </Link>
      </div>
    </main>
  );
}
