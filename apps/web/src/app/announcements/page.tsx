import Link from 'next/link';
import {getDictionary,DEFAULT_LOCALE} from '@web/lib/i18n';
import {fetchPublicApi} from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import type {SitePage} from '@rumiai/contracts/site-content/types';
import {PublicHeader} from '@/components/layout/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SiteBlocks} from '@/components/site-content/site-blocks';


export default async function AnnouncementsPage(){const rows=await fetchPublicApi<SitePage[]>('/api/site/announcements'),dict=getDictionary(DEFAULT_LOCALE);return <main className="flex min-h-[100svh] flex-col bg-background text-foreground"><PublicHeader locale={DEFAULT_LOCALE} signInLabel={dict.signIn}/><section className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-6 py-12"><h1 className="text-3xl font-bold">站点公告</h1>{rows.map(row=><article key={row.id} className="rounded-2xl border border-border p-5"><p className="text-xs text-muted-foreground">{new Date(row.startsAt??row.createdAt??'').toLocaleDateString('zh-CN')}</p><h2 className="mt-2 text-xl font-semibold"><Link href={`/pages/${row.slug}`} className="hover:text-primary">{row.title}</Link></h2>{row.summary&&<p className="mt-2 text-sm text-muted-foreground">{row.summary}</p>}<SiteBlocks blocks={row.blocks}/></article>)}{rows.length===0&&<p className="rounded-xl border p-5 text-muted-foreground">暂无公告。</p>}</section><PublicFooter/></main>;}
