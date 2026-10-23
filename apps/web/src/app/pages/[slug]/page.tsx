import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {getDictionary,DEFAULT_LOCALE} from '@web/lib/i18n';
import {fetchPublicApi} from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import type {SitePage} from '@rumiai/contracts/site-content/types';
import {PublicHeader} from '@/components/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SiteBlocks} from '@/components/site-content/site-blocks';


export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const {slug}=await params,page=await fetchPublicApi<SitePage>(`/api/site/pages/${encodeURIComponent(slug)}`);return page?{title:page.title,description:page.summary||undefined}:{};}
export default async function SitePage({params}:{params:Promise<{slug:string}>}){const {slug}=await params,page=await fetchPublicApi<SitePage>(`/api/site/pages/${encodeURIComponent(slug)}`);if(!page)notFound();const dict=getDictionary(DEFAULT_LOCALE);return <main className="flex min-h-[100svh] flex-col"><PublicHeader locale={DEFAULT_LOCALE} signInLabel={dict.signIn}/><article className="mx-auto w-full max-w-3xl flex-1 px-6 py-12"><h1 className="break-words text-3xl font-bold">{page.title}</h1>{page.summary&&<p className="mt-3 text-zinc-400">{page.summary}</p>}<SiteBlocks blocks={page.blocks}/></article><PublicFooter/></main>;}
