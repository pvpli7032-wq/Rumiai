import type { Metadata } from 'next';
import { SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale } from '@/lib/i18n';
import { PublicHeader } from '@/components/public-header';

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: dict.aboutTitle,
    description: dict.siteDescription,
    alternates: {
      canonical: `${SITE_URL}/${params.locale}/about`,
      languages: alternateLanguages('/about'),
    },
  };
}

export default async function AboutPage({ params: paramsPromise }: { params: Promise<{ locale: string }> }) {
  const params = await paramsPromise;

  const locale = (isLocale(params.locale) ? params.locale : 'th') as Locale;
  const dict = getDictionary(locale);

  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <article className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="font-athiti text-3xl font-bold text-white">{dict.aboutHeading}</h1>
        <div className="mt-6 space-y-4">
          {dict.aboutBody.map(paragraph => (
            <p key={paragraph} className="font-athiti leading-relaxed text-zinc-300">
              {paragraph}
            </p>
          ))}
        </div>
      </article>
    </main>
  );
}
