import Link from 'next/link';
import { DEFAULT_LOCALE, getDictionary } from '@/lib/i18n';

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
      <p className="text-6xl font-bold text-white/20">404</p>
      <h1 className="text-xl font-semibold text-white">页面不存在</h1>
      <p className="max-w-sm text-zinc-400">
        页面可能已移动或删除，请返回发现页。
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href={`/${DEFAULT_LOCALE}`}
          className="rounded-full bg-linear-to-r/srgb from-purple-600 to-pink-600 px-6 py-2.5 font-semibold text-white"
        >
          {dict.chatNow}
        </Link>
        <Link
          href={`/${DEFAULT_LOCALE}/explore`}
          className="rounded-full border border-white/15 px-6 py-2.5 text-white transition-colors hover:bg-white/5"
        >
          {dict.charactersSection}
        </Link>
      </div>
    </main>
  );
}
