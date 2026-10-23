import type {Metadata} from 'next';
import {SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale, DEFAULT_LOCALE} from '@web/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SiteBlocks} from '@/components/site-content/site-blocks';
import {fetchPublicApi} from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import type {SitePage} from '@rumiai/contracts/site-content/types';


export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{const {locale}=await params;if(!isLocale(locale))return{};const page=await fetchPublicApi<SitePage>('/api/site/pages/about').catch(()=>null),dict=getDictionary(locale);return{title:page?.title??dict.aboutTitle,description:page?.summary||dict.siteDescription,alternates:{canonical:`${SITE_URL}/${locale}/about`,languages:alternateLanguages('/about')}};}
export default async function AboutPage({params}:{params:Promise<{locale:string}>}){const {locale:raw}=await params,locale=(isLocale(raw)?raw:DEFAULT_LOCALE) as Locale,dict=getDictionary(locale),page=await fetchPublicApi<SitePage>('/api/site/pages/about').catch(()=>null);return <main className="flex min-h-[100svh] flex-col"><PublicHeader locale={locale} signInLabel={dict.signIn}/><article className="mx-auto w-full max-w-2xl flex-1 px-6 py-12"><h1 className="text-3xl font-bold text-white">{page?.title??dict.aboutHeading}</h1>{page?<SiteBlocks blocks={page.blocks}/>:<div className="mt-6 space-y-4">{dict.aboutBody.map(paragraph=><p key={paragraph} className="leading-relaxed text-zinc-300">{paragraph}</p>)}</div>}</article><PublicFooter/></main>;}
