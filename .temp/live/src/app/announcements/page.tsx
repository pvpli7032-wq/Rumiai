import Link from 'next/link';
import {getDictionary,DEFAULT_LOCALE} from '@/lib/i18n';
import {readPublishedAnnouncements} from '@/lib/site-content/public-service';
import {PublicHeader} from '@/components/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SiteBlocks} from '@/components/site-content/site-blocks';

export const dynamic='force-dynamic';
export default async function AnnouncementsPage(){const rows=await readPublishedAnnouncements(),dict=getDictionary(DEFAULT_LOCALE);return <main className="flex min-h-[100svh] flex-col"><PublicHeader locale={DEFAULT_LOCALE} signInLabel={dict.signIn}/><section className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-6 py-12"><h1 className="text-3xl font-bold">站点公告</h1>{rows.map(row=><article key={row.id} className="rounded-2xl border border-border p-5"><p className="text-xs text-muted-foreground">{new Date(row.startsAt??row.createdAt).toLocaleDateString('zh-CN')}</p><h2 className="mt-2 text-xl font-semibold"><Link href={`/pages/${row.slug}`} className="hover:text-orange-500">{row.title}</Link></h2>{row.summary&&<p className="mt-2 text-sm text-muted-foreground">{row.summary}</p>}<SiteBlocks blocks={row.blocks}/></article>)}{rows.length===0&&<p className="rounded-xl border p-5 text-muted-foreground">暂无公告。</p>}</section><PublicFooter/></main>;}
