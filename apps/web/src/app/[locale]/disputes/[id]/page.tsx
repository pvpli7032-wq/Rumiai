import type {Metadata} from 'next';
import {getDictionary, isLocale, type Locale, DEFAULT_LOCALE, SITE_URL, alternateLanguages} from '@web/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {DisputeDetail} from '@/components/disputes/dispute-detail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({params: paramsPromise}: {params: Promise<{locale: string; id: string}>}): Promise<Metadata> {
  const params = await paramsPromise;
  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  // 结案内容不在元信息里复述：摘录与诉求属于用户内容，标题只给通用描述。
  return {
    title: `评理案例 | ${dict.siteTitle}`,
    description: '看看大家的票数与结论。',
    alternates: {canonical: `${SITE_URL}/${params.locale}/disputes/${params.id}`, languages: alternateLanguages(`/disputes/${params.id}`)},
  };
}

export default async function DisputeDetailPage({params: paramsPromise}: {params: Promise<{locale: string; id: string}>}) {
  const params = await paramsPromise;
  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <div className="mx-auto w-full max-w-3xl px-5 pb-16">
        <DisputeDetail caseId={params.id} locale={locale} />
      </div>
    </main>
  );
}
