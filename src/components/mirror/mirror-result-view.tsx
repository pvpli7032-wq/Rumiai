'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui';
import {api, ApiError} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';
import {DeleteResultButton} from './delete-result-button';
import {MirrorActions} from './mirror-actions';
import {MirrorResultCard} from './result-card';
import type {MirrorView} from './client-types';

/**
 * 结果页：公开只读结果字段；本人（或匿名归属凭据持有人）额外看到三题原回答与删除。
 * 分享按钮只分享结果页链接，从不把原回答放进去。
 */
export function MirrorResultView({view, locale}: {view: MirrorView; locale: string}) {
  const router = useRouter();
  const {token} = useAuth();
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const result = view.result;
  const owner = view.kind === 'owner';

  async function share() {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    try {
      if (navigator.share) { await navigator.share({title: `${result.characterName}眼中的我`, text: result.title, url}); setShareState('copied'); return; }
      await navigator.clipboard.writeText(url);
      setShareState('copied');
    } catch {
      setShareState('failed');
    }
  }

  async function remove() {
    try {
      await api.del(API.mirror.result(result.shareId), {token});
      setDeleted(true);
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) { setDeleted(true); return; }
      setMessage(cause instanceof ApiError ? cause.message : '删除失败，请稍后重试。');
    }
  }

  if (deleted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>这条结果已删除</CardTitle>
          <CardDescription>分享链接已经失效，其他人也看不到了。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => router.push(`/${locale}/mirror`)}>再做一次</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="h-12 w-12 overflow-hidden rounded-full bg-muted">
          {result.characterAvatarUrl ? <img src={result.characterAvatarUrl} alt="" className="h-full w-full object-cover" /> : null}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{result.characterName}眼中的你</p>
          <p className="text-xs text-muted-foreground">{new Date(result.createdAt).toLocaleString('zh-CN')}{result.expiresAt ? ` · ${new Date(result.expiresAt).toLocaleDateString('zh-CN')} 到期` : ''}</p>
        </div>
      </header>

      <MirrorResultCard fields={result} />

      <MirrorActions characterId={result.characterId} canShare onShare={share} />
      {shareState === 'copied' && <Badge variant="success">分享链接已复制</Badge>}
      {shareState === 'failed' && <p className="text-sm text-destructive">没能复制链接，请手动复制地址栏。</p>}
      {message && <p className="text-sm text-destructive">{message}</p>}

      {owner && (
        <Card>
          <CardHeader>
            <CardTitle>只有你能看到的参考答案</CardTitle>
            <CardDescription>分享页不展示这三段回答。</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
              {view.result.answers.map((answer, index) => <li key={index}>{answer}</li>)}
            </ol>
            <div className="mt-4">
              <DeleteResultButton onDelete={remove} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
