import type {Metadata} from 'next';
import {DEFAULT_LOCALE, SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale} from '@web/lib/i18n';
import {PublicHeader} from '@/components/layout/public-header';
import {MirrorHome} from '@/components/mirror/mirror-home';

/**
 * 他眼中的你入口（V3 §23）：公开入口，选运营指定角色 → 答三题 → 得到可分享结果。
 * 页面本身是 Server Component，匿名主体的 Cookie 由客户端挂载后的初始化请求签发。
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({params: paramsPromise}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const params = await paramsPromise;
  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: `他眼中的你 | ${dict.siteTitle}`,
    description: '选一个角色，回答几道短问题，看看 TA 眼中的你是什么样子。',
    alternates: {canonical: `${SITE_URL}/${params.locale}/mirror`, languages: alternateLanguages('/mirror')},
  };
}

export default async function MirrorPage({params: paramsPromise}: {params: Promise<{locale: string}>}) {
  const params = await paramsPromise;
  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  return (
    <main className="mx-auto flex min-h-[100svh] max-w-3xl flex-col px-4 pb-16 desktop:px-8">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <section className="py-6">
        <h1 className="text-2xl font-bold text-foreground desktop:text-3xl">他眼中的你</h1>
        <p className="mt-2 text-sm text-muted-foreground">选一个角色，回答几道短问题，TA 会说出眼中的你。结果由 AI 生成，可以分享给朋友。</p>
      </section>
      <MirrorHome initialPage={null} locale={locale} />
    </main>
  );
}
