'use client';

import {useEffect, useState} from 'react';
import {Copy, Gift} from 'lucide-react';
import {api, ApiError} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';
import {Button, Card, EmptyState, ErrorState, Skeleton} from '@/components/ui';
import type {InvitePayload} from './types';

export function InviteCard() {
  const {token} = useAuth();
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [copyState, setCopyState] = useState<'code' | 'link' | 'failed' | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setPayload(null);
    setLoadError('');
    api
      .get<InvitePayload>(API.growth.invite, {token, signal: controller.signal})
      .then(data => {
        if (!controller.signal.aborted) setPayload(data);
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof ApiError ? cause.message : '邀请信息加载失败，请稍后重试。');
      });
    return () => controller.abort();
  }, [token, reloadToken]);

  async function copy(kind: 'code' | 'link', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
    } catch {
      setCopyState('failed');
    }
  }

  if (!token) return null;

  if (loadError) {
    return (
      <Card>
        <div className="p-4">
          <ErrorState
            title="邀请信息加载失败"
            description={loadError}
            action={
              <Button variant="outline" size="sm" onClick={() => setReloadToken(value => value + 1)}>
                重试
              </Button>
            }
          />
        </div>
      </Card>
    );
  }

  if (!payload) {
    return (
      <Card>
        <div className="space-y-2 p-4">
          <Skeleton shape="text" className="w-24" />
          <Skeleton className="h-10" />
        </div>
      </Card>
    );
  }

  // 开关关闭：不展示入口，连卡片都不出现。
  if (!payload.enabled) return null;

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Gift aria-hidden className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-semibold text-foreground">邀请好友</h2>
        </div>
        {payload.code || payload.link ? (
          <>
            {payload.code && (
              <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{payload.code}</span>
                <Button variant="outline" size="sm" leadingIcon={<Copy aria-hidden className="h-3.5 w-3.5" />} onClick={() => void copy('code', payload.code ?? '')}>
                  复制邀请码
                </Button>
              </div>
            )}
            {payload.link && (
              <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{payload.link}</span>
                <Button variant="outline" size="sm" leadingIcon={<Copy aria-hidden className="h-3.5 w-3.5" />} onClick={() => void copy('link', payload.link ?? '')}>
                  复制链接
                </Button>
              </div>
            )}
            {payload.rewardCoins > 0 && (
              <p className="text-xs leading-5 text-muted-foreground">
                好友通过你的邀请注册并完成首次聊天后，你获得 {payload.rewardCoins} 金币。
              </p>
            )}
            {copyState && (
              <p role="status" className="text-xs text-muted-foreground">
                {copyState === 'failed' ? '复制失败，请长按上面的内容手动复制。' : copyState === 'code' ? '邀请码已复制。' : '分享链接已复制。'}
              </p>
            )}
          </>
        ) : (
          <EmptyState title="邀请码暂未生成" description="稍后刷新本页再试。" />
        )}
      </div>
    </Card>
  );
}
