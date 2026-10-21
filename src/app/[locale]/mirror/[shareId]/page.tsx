import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {headers} from 'next/headers';
import {DEFAULT_LOCALE, SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale} from '@/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {MirrorResultView} from '@/components/mirror/mirror-result-view';
import {MirrorError, mirrorAttributionCookieName, readCookie, readMirrorContext, readMirrorResult} from '@/lib/mirror';

/**
 * 结果页（公开只读）：只读结果字段，不展示三题原回答。
 * 本人或匿名归属凭据持有人额外看到自己的回答与删除按钮；删除后、过期后一律 404。
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({params: paramsPromise}: {params: Promise<{locale: string; shareId: string}>}): Promise<Metadata> {
  const params = await paramsPromise;
  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: `他眼中的我 | ${dict.siteTitle}`,
    description: 'TA 眼中的我是什么样的。结果由 AI 生成。',
    alternates: {canonical: `${SITE_URL}/${params.locale}/mirror/${params.shareId}`, languages: alternateLanguages(`/mirror/${params.shareId}`)},
  };
}

export default async function MirrorResultPage({params: paramsPromise}: {params: Promise<{locale: string; shareId: string}>}) {
  const params = await paramsPromise;
  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);

  const requestHeaders = await headers();
  const context = await readMirrorContext(new Request(SITE_URL, {headers: requestHeaders}));
  const attribution = readCookie(requestHeaders.get('cookie'), mirrorAttributionCookieName(params.shareId));

  const view = await readMirrorResult(params.shareId, {userId: context.userId, subject: context.subject}, attribution).catch(error => {
    if (error instanceof MirrorError && error.status === 404) notFound();
    throw error;
  });

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-3xl flex-col px-4 pb-16 desktop:px-8">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <section className="py-6">
        <MirrorResultView view={view} locale={locale} />
        <p className="mt-6 text-xs text-muted-foreground">结果由 AI 生成，仅供娱乐。</p>
      </section>
    </main>
  );
}
