import type {Metadata} from 'next';
import Link from 'next/link';
import {getDictionary, isLocale, type Locale, DEFAULT_LOCALE, SITE_URL, alternateLanguages} from '@/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {BannerCarousel, type HeroBanner} from '@/components/banner-carousel';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SignedInRedirect} from './signed-in-redirect';
import {readPublicSiteContent} from '@/lib/site-content/public-service';
import {listCharacters} from '@/lib/characters/catalog-service';
import {compactNumber} from '@/lib/i18n/format';
import {readSettingValue} from '@/lib/settings/service';
import {readHomeCopyOverrides} from '@/lib/site-content/home-copy';
import type {LandingCopy} from '@/lib/i18n/landing-copy';

export const dynamic = 'force-dynamic';

export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const {locale: raw} = await params;
  if (!isLocale(raw)) return {};
  const dict = getDictionary(raw);
  const title = `${dict.landing.headline} · ${dict.siteTitle}`;
  return {
    title,
    description: dict.landing.subhead,
    alternates: {canonical: `${SITE_URL}/${raw}`, languages: alternateLanguages('/')},
    openGraph: {title, description: dict.landing.subhead, url: `${SITE_URL}/${raw}`, type: 'website'},
  };
}

/**
 * 公开落地页。访问者还没登录，这一页只做四件事：说清价值、露出真实角色、
 * 说明怎么开始、把安全与合规讲明白。数据全部来自公开接口，不读登录态。
 */
export default async function LocaleHome({params}: {params: Promise<{locale: string}>}) {
  const {locale: raw} = await params;
  const locale = (isLocale(raw) ? raw : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  // 后台站点内容（slug=home）覆盖标题、副标题、两个按钮与「他眼中的你」卡片；没配就用字典。
  const copy: LandingCopy = {...dict.landing, ...(await readHomeCopyOverrides())};
  const [site, characters, mirrorEnabled] = await Promise.all([
    readPublicSiteContent(),
    listCharacters({sort: 'popular'}),
    // 玩法开关关闭时入口整块不出现（V3 表 15 只列当前开放的玩法）。
    readSettingValue<boolean>('mirror.enabled'),
  ]);
  const featured = characters.slice(0, 6);
  const banners = site.banners.hero as HeroBanner[];

  return (
    <main className="flex min-h-[100svh] flex-col">
      <SignedInRedirect/>
      <PublicHeader locale={locale} signInLabel={dict.signIn}/>

      {/* 后台配置的首页横幅：仍由站点内容管理，落地页只在顶部展示，不再轮播整屏 */}
      {banners.length > 0 && (
        <div className="mx-auto w-full max-w-6xl px-6 pt-2">
          <BannerCarousel
            banners={banners}
            labels={{prev: dict.prevBanner, next: dict.nextBanner, dots: banners.map((_, i) => dict.goToBanner(i + 1)), nav: dict.bannerNav}}
          />
        </div>
      )}

      {/* 1. 价值主张 */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-10 pt-8 text-center">
        <h1 className="text-3xl font-bold leading-tight text-white desktop:text-5xl">{copy.headline}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 desktop:text-base">{copy.subhead}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={`/${locale}/auth`}
            className="inline-flex min-h-12 items-center rounded-full bg-brand-gradient px-8 text-base font-semibold text-white shadow-lg transition-transform hover:scale-[1.02]"
          >
            {copy.primaryCta}
          </Link>
          <Link
            href={`/${locale}/explore`}
            className="inline-flex min-h-12 items-center rounded-full border border-white/20 px-6 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/40 hover:text-white"
          >
            {copy.secondaryCta}
          </Link>
        </div>
        <p className="mt-4 text-xs text-zinc-500">{copy.aiNotice}</p>
      </section>

      {/* 2. 热门角色：直接给真实数据，不用假图 */}
      {featured.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-6 py-8">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white desktop:text-2xl">{copy.featuredTitle}</h2>
              <p className="mt-1 text-xs text-zinc-500">{copy.featuredHint}</p>
            </div>
            <Link href={`/${locale}/explore`} className="shrink-0 text-xs font-semibold text-zinc-400 hover:text-white">
              {copy.featuredMore}
            </Link>
          </div>
          <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 desktop:grid-cols-3">
            {featured.map(character => (
              <li key={character.id}>
                <Link
                  href={`/${locale}/character/${character.id}`}
                  className="group flex h-full gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-white/25"
                >
                  <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-800">
                    {character.avatarUrl
                      ? <img src={character.avatarUrl} alt="" width={64} height={64} className="h-full w-full object-cover"/>
                      : <span aria-hidden className="text-2xl">🎭</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-white">{character.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-zinc-400">
                      {character.tagline || character.personality}
                    </span>
                    <span className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span>💬 {compactNumber(character.chatCount)}</span>
                      {character.creator && <span className="truncate">@{character.creator.displayName || character.creator.username}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. 他眼中的你：表 15 要求的独立入口，落在玩法说明之前 */}
      {mirrorEnabled && (
        <section className="mx-auto w-full max-w-5xl px-6 py-4">
          <Link
            href={`/${locale}/mirror`}
            className="group flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/25"
          >
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">{copy.mirrorTitle}</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">{copy.mirrorBody}</p>
            </div>
            <span className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/20 px-5 text-sm font-semibold text-zinc-100 transition-colors group-hover:border-white/40 group-hover:text-white">
              {copy.mirrorCta}
            </span>
          </Link>
        </section>
      )}

      {/* 4. 三步玩法 */}
      <section className="mx-auto w-full max-w-5xl px-6 py-8">
        <h2 className="text-xl font-bold text-white desktop:text-2xl">{copy.stepsTitle}</h2>
        <ol className="mt-5 grid gap-4 desktop:grid-cols-3">
          {copy.steps.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white">{index + 1}</span>
              <h3 className="mt-3 text-base font-bold text-white">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. 示例对话：明确标注是示例，不是真实生成内容 */}
      <section className="mx-auto w-full max-w-3xl px-6 py-8">
        <h2 className="text-xl font-bold text-white desktop:text-2xl">{copy.sampleTitle}</h2>
        <p className="mt-1 text-xs text-zinc-500">{copy.sampleHint}</p>
        <div className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-gradient px-4 py-2.5 text-sm leading-relaxed text-white">
            {copy.sample.user}
          </p>
          <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-2.5 text-sm leading-relaxed text-zinc-100">
            {copy.sample.character}
          </p>
        </div>
      </section>

      {/* 5. 安全与合规 */}
      <section className="mx-auto w-full max-w-5xl px-6 py-8">
        <h2 className="text-xl font-bold text-white desktop:text-2xl">{copy.safetyTitle}</h2>
        <ul className="mt-4 space-y-2.5">
          {copy.safety.map(item => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-zinc-300">
              <span aria-hidden className="mt-0.5 shrink-0 text-brand-2">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-zinc-400">
          <Link href={`/${locale}/terms-and-policy`} className="underline underline-offset-4 hover:text-white">{dict.termsHeading}</Link>
          <span className="mx-2 text-zinc-600">·</span>
          <Link href={`/${locale}/about`} className="underline underline-offset-4 hover:text-white">{dict.aboutHeading}</Link>
        </p>
      </section>

      {/* 6. FAQ：用原生 details，无脚本也能展开 */}
      <section className="mx-auto w-full max-w-3xl px-6 py-8">
        <h2 className="text-xl font-bold text-white desktop:text-2xl">{copy.faqTitle}</h2>
        <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {copy.faq.map(item => (
            <details key={item.q} className="group py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-100">
                {item.q}
                <span aria-hidden className="shrink-0 text-zinc-500 transition-transform group-open:rotate-45">＋</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 7. 收尾 CTA */}
      <section className="mx-auto w-full max-w-3xl px-6 py-10 text-center">
        <h2 className="text-xl font-bold text-white desktop:text-2xl">{copy.closingTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">{copy.closingBody}</p>
        <Link
          href={`/${locale}/auth`}
          className="mt-5 inline-flex min-h-12 items-center rounded-full bg-brand-gradient px-8 text-base font-semibold text-white shadow-lg transition-transform hover:scale-[1.02]"
        >
          {copy.primaryCta}
        </Link>
      </section>

      <PublicFooter/>
    </main>
  );
}
