import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {DEFAULT_LOCALE, SITE_URL, getDictionary} from '@web/lib/i18n';
import {PublicHeader} from '@/components/public-header';
import {PublicFooter} from '@/components/site-content/public-footer';
import {fetchPublicApi, PublicApiError} from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import type {SharedConversationProjection} from '@rumiai/contracts/public-api';



export const metadata: Metadata = {title: '分享的对话 | 星伴', robots: {index: false, follow: false}};

/** 公开链接里显示几条；与分享接口的 EXCERPT_TURNS 同一个量级，只截最近的一段。 */
const VISIBLE_TURNS = 12;

/**
 * 分享出来的对话（V3 表 15 聊天页「分享」的落地页）。
 *
 * 内容按对话主人的视角读取：消息表跟对话绑定，链接里没有用户标识，猜不到别人的对话。
 * 页面用 noindex 且不被搜索收录——分享是给人看的，不是给爬虫建库的。
 */
export default async function SharedChatPage({params: paramsPromise}: {params: Promise<{id: string}>}) {
  const {id} = await paramsPromise;
  const dict = getDictionary(DEFAULT_LOCALE);
  let conversation: SharedConversationProjection;
  try { conversation = await fetchPublicApi<SharedConversationProjection>(`/api/public-conversations/${encodeURIComponent(id)}`); } catch (error) { if (error instanceof PublicApiError && error.status === 404) notFound(); throw error; }
  const messages = [...conversation.messages].reverse();

  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={DEFAULT_LOCALE} signInLabel={dict.signIn} />
      <article className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <p className="text-xs text-zinc-500">一段分享的对话 · 内容由 AI 按角色设定生成，不是真人</p>
        <div className="mt-3 flex items-center gap-3">
          {conversation.character?.avatarUrl
            ? <img src={conversation.character.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
            : <div className="h-12 w-12 rounded-full bg-zinc-800" />}
          <div>
            <h1 className="text-xl font-bold text-white">{conversation.character?.name ?? '未知角色'}</h1>
            {conversation.title && <p className="text-xs text-zinc-500">{conversation.title}</p>}
          </div>
        </div>

        <ul className="mt-6 space-y-3">
          {messages.map(message => (
            <li key={message.id} className={message.role === 'USER' ? 'text-right' : ''}>
              <p className={`inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-left text-sm ${message.role === 'USER' ? 'bg-brand-soft text-zinc-100' : 'bg-zinc-900/70 text-zinc-300'}`}>
                {message.content}
              </p>
            </li>
          ))}
        </ul>
        {messages.length === 0 && <p className="mt-6 text-sm text-zinc-500">这段对话还没有消息。</p>}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/${DEFAULT_LOCALE}`} className="inline-flex min-h-11 items-center rounded-full bg-brand-gradient px-6 text-sm font-semibold text-white">
            我也来聊
          </Link>
          {conversation.character && (
            <Link href={`/${DEFAULT_LOCALE}/character/${conversation.character.id}`} className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-6 text-sm text-zinc-200">
              看看这个角色
            </Link>
          )}
        </div>
        <p className="mt-6 break-all text-xs text-zinc-600">原链接：{SITE_URL}/share/chat/{conversation.id}</p>
      </article>
      <PublicFooter />
    </main>
  );
}
