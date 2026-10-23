import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {headers} from 'next/headers';
import {DEFAULT_LOCALE, SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale} from '@web/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {MirrorResultLoader} from '@/components/mirror/mirror-result-loader';
import type {MirrorView} from '@/components/mirror/client-types';
import {fetchPublicApi, PublicApiError} from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import {MIRROR_PREVIEW_SIZE} from './_preview-card';

/**
 * 结果页（公开只读）：只读结果字段，不展示三题原回答。
 * 本人或匿名归属凭据持有人额外看到自己的回答与删除按钮；删除后、过期后一律 404。
 */


export async function generateMetadata({params: paramsPromise}: {params: Promise<{locale: string; shareId: string}>}): Promise<Metadata> {
  const params = await paramsPromise;
  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  const url = `${SITE_URL}/${params.locale}/mirror/${params.shareId}`;
  return {
    title: `他眼中的我 | ${dict.siteTitle}`,
    description: 'TA 眼中的我是什么样的。结果由 AI 生成。',
    alternates: {canonical: url, languages: alternateLanguages(`/mirror/${params.shareId}`)},
    openGraph: {
      title: '他眼中的我 | 星伴',
      description: 'TA 眼中的我是什么样的。结果由 AI 生成。',
      url,
      type: 'website',
      // 预览图由同目录的 opengraph-image.tsx 用 next/og 生成，只含公开结果字段。
      // 这里写绝对地址：相对地址会按当前来源解析，开发环境会把 localhost 带进预览。
      images: [{
        url: `${SITE_URL}/${params.locale}/mirror/${params.shareId}/opengraph-image`,
        width: MIRROR_PREVIEW_SIZE.width,
        height: MIRROR_PREVIEW_SIZE.height,
        alt: '他眼中的你 · 分享预览',
      }],
    },
    twitter: {card: 'summary_large_image'},
  };
}

export default async function MirrorResultPage({params: paramsPromise}: {params: Promise<{locale: string; shareId: string}>}) {
  const params = await paramsPromise;
  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);

  const requestHeaders = await headers();
  let view: MirrorView;
  try { view = await fetchPublicApi(`/api/mirror/${encodeURIComponent(params.shareId)}`, {headers: {cookie: requestHeaders.get('cookie') ?? '', ...(requestHeaders.get('authorization') ? {authorization: requestHeaders.get('authorization')!} : {})}}); }
  catch (error) { if (error instanceof PublicApiError && error.status === 404) notFound(); throw error; }

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-3xl flex-col px-4 pb-16 desktop:px-8">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <section className="py-6">
        <MirrorResultLoader shareId={params.shareId} locale={locale} initialView={view} />
        <p className="mt-6 text-xs text-muted-foreground">结果由 AI 生成，仅供娱乐。</p>
      </section>
    </main>
  );
}
