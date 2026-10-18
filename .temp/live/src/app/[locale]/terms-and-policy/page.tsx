import type {Metadata} from 'next';
import {SITE_URL,alternateLanguages,getDictionary,isLocale,type Locale} from '@/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {SiteBlocks} from '@/components/site-content/site-blocks';
import {readPublishedSitePage} from '@/lib/site-content/public-service';

export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{const {locale}=await params;if(!isLocale(locale))return{};const page=await readPublishedSitePage('terms-and-policy'),dict=getDictionary(locale);return{title:page?.title??dict.termsTitle,description:page?.summary||dict.siteDescription,alternates:{canonical:`${SITE_URL}/${locale}/terms-and-policy`,languages:alternateLanguages('/terms-and-policy')}};}
export default async function TermsPage({params}:{params:Promise<{locale:string}>}){const {locale:raw}=await params,locale=(isLocale(raw)?raw:'th') as Locale,dict=getDictionary(locale),page=await readPublishedSitePage('terms-and-policy');return <main className="flex min-h-[100svh] flex-col"><PublicHeader locale={locale} signInLabel={dict.signIn}/><article className="mx-auto w-full max-w-2xl flex-1 px-6 py-12"><h1 className="font-athithi text-3xl font-bold text-white">{page?.title??dict.termsHeading}</h1>{page?<SiteBlocks blocks={page.blocks}/>:<><p className="mt-6 font-athithi leading-relaxed text-zinc-400">当前为内部测试版。注册信息、角色与对话保存在服务器数据库；启用真实 AI 时，上下文发送给配置的模型服务商。真实充值由商户配置与开关控制，默认关闭。隔离开发环境的模拟购买不发生真实扣款。个人页可导出数据或注销；注销清除本人资料和内容，账务、举报证据和其他用户历史按注销说明保留。旧共享文件、备份及供应商数据需运营方核查。请勿上传未经授权素材或敏感个人信息。正式上线前还需补充运营方信息、正式政策、保留期限及未成年人规则。</p><p className="mt-4 text-xs text-amber-300">发布正式条款前，请由运营方完成法律文本及年龄准入审核。</p></>}</article><PublicFooter/></main>;}
