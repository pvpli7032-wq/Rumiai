import type {Metadata} from 'next';
import {SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale, DEFAULT_LOCALE} from '@web/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SiteBlocks} from '@/components/site-content/site-blocks';
import {fetchPublicApi} from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import type {SitePage} from '@rumiai/contracts/site-content/types';
import {PRIVACY_ZH, TERMS_ZH, type LegalDocument} from '@rumiai/contracts/legal-documents';



export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const {locale} = await params;
  if (!isLocale(locale)) return {};
  const page = await fetchPublicApi<SitePage>('/api/site/pages/terms-and-policy').catch(()=>null);
  const dict = getDictionary(locale);
  return {
    title: page?.title ?? dict.termsTitle,
    description: page?.summary || dict.siteDescription,
    alternates: {canonical: `${SITE_URL}/${locale}/terms-and-policy`, languages: alternateLanguages('/terms-and-policy')},
  };
}

/** 条款正文：标题、更新日期、审核提示、分节段落。 */
function LegalBody({document}: {document: LegalDocument}) {
  return (
    <section className="mt-10" aria-labelledby={`legal-${document.title}`}>
      <h2 id={`legal-${document.title}`} className="text-2xl font-bold text-white">{document.title}</h2>
      <p className="mt-1 text-xs text-zinc-500">更新日期：{document.updated}</p>
      <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
        {document.notice}
      </p>
      <div className="mt-6 space-y-6">
        {document.sections.map(section => (
          <div key={section.heading}>
            <h3 className="text-base font-semibold text-zinc-100">{section.heading}</h3>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="mt-2 text-sm leading-7 text-zinc-400">{paragraph}</p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function TermsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale: raw} = await params;
  const locale = (isLocale(raw) ? raw : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  const page = await fetchPublicApi<SitePage>('/api/site/pages/terms-and-policy').catch(()=>null);
  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn}/>
      <article className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-bold text-white">{page?.title ?? dict.termsHeading}</h1>
        {page ? (
          <SiteBlocks blocks={page.blocks}/>
        ) : (
          <>
            {locale !== 'zh' && (
              <p className="mt-4 text-sm text-zinc-400">本页正式文本为简体中文，其他语言版本尚未提供。</p>
            )}
            <LegalBody document={TERMS_ZH}/>
            <LegalBody document={PRIVACY_ZH}/>
          </>
        )}
      </article>
      <PublicFooter/>
    </main>
  );
}
