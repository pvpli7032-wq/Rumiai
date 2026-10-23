import type {Metadata} from 'next';
import {getDictionary, isLocale, type Locale, DEFAULT_LOCALE, SITE_URL, alternateLanguages} from '@web/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {DisputeBoard} from '@/components/disputes/dispute-board';

export const dynamic = 'force-dynamic';

export async function generateMetadata({params: paramsPromise}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const params = await paramsPromise;
  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: `评理广场 | ${dict.siteTitle}`,
    description: '从聊天摘出片段，说清诉求，让大家投票谁更有理。',
    alternates: {canonical: `${SITE_URL}/${params.locale}/disputes`, languages: alternateLanguages('/disputes')},
  };
}

export default async function DisputesPage({params: paramsPromise}: {params: Promise<{locale: string}>}) {
  const params = await paramsPromise;
  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <DisputeBoard locale={locale} />
    </main>
  );
}
