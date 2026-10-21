import type {Metadata} from 'next';
import Link from 'next/link';
import {getDictionary, isLocale, type Locale, DEFAULT_LOCALE} from '@/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {DisputeComposer} from '@/components/disputes/dispute-composer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {title: '发起评理 | 星伴', description: '从自己的聊天里选一段，说清诉求。', robots: {index: false, follow: false}};

export default async function NewDisputePage({params: paramsPromise}: {params: Promise<{locale: string}>}) {
  const params = await paramsPromise;
  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <div className="mx-auto w-full max-w-3xl space-y-4 px-5 pb-16">
        <header>
          <Link href={`/${locale}/disputes`} className="text-sm text-brand underline-offset-4 hover:underline">← 评理广场</Link>
          <h1 className="mt-2 text-2xl font-bold">发起评理</h1>
          <p className="mt-1 text-sm text-muted-foreground">摘录与诉求公开后不再可改；不满可以撤回，撤回后停止公开访问。</p>
        </header>
        <DisputeComposer locale={locale} />
      </div>
    </main>
  );
}
