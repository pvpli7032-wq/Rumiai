'use client';
import {useCallback, useMemo, useState} from 'react';
import {AlertCircle, RefreshCw} from 'lucide-react';
import {Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle} from '@rumiai/ui';
import {api, ApiError} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {MirrorResultCard} from './result-card';
import type {MirrorCompareResponse, MirrorPageResponse} from './client-types';

/**
 * 多角色对比（V3 §23）：从「我的结果」里挑最多 compareLimit 个不同角色，并排看。
 *
 * - 上限来自服务端设置（page.rules.compareLimit），前端不写死；
 * - 每条结果独立成卡：成功显示结果字段，失败显示原因并可单独重试；
 * - 重试只重取这一条（只带一个 shareId），对比是纯读，不会重新生成或重复扣费；
 * - 卡片只渲染 MirrorResultFields：对比接口的成功分支是公开视图，根本没有 answers 字段。
 */
export function MirrorCompare({token, mine, compareLimit}: {token: string; mine: MirrorPageResponse['mine']; compareLimit: number}) {
  // 同一角色只留最近一条：拿同一个角色的两条结果并排比没有意义。
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return mine.filter(item => (seen.has(item.characterId) ? false : (seen.add(item.characterId), true)));
  }, [mine]);
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<MirrorCompareResponse['entries'] | null>(null);
  const [limit, setLimit] = useState(compareLimit);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchOne = useCallback(async (shareIds: string[]) => {
    const query = shareIds.map(id => 'shareId=' + encodeURIComponent(id)).join('&');
    return api.get<MirrorCompareResponse>(API.mirror.compare + '?' + query, {token});
  }, [token]);

  const compare = useCallback(async (shareIds: string[]) => {
    if (!shareIds.length) { setEntries(null); return; }
    setLoading(true); setError(null);
    try {
      const data = await fetchOne(shareIds);
      setEntries(data.entries);
      setLimit(data.compareLimit);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '对比暂时打不开，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [fetchOne]);

  // 单独重试：只带这一个 shareId，回来只替换它自己那一条，其他条目原样保留。
  async function retry(shareId: string) {
    setRetrying(shareId);
    try {
      const data = await fetchOne([shareId]);
      const fresh = data.entries.find(entry => entry.shareId === shareId);
      if (fresh) setEntries(current => current?.map(entry => (entry.shareId === shareId ? fresh : entry)) ?? [fresh]);
    } catch {
      // 重试也失败就保留原来那张失败卡，不把它变成空白。
    } finally {
      setRetrying(null);
    }
  }

  function toggle(shareId: string) {
    setSelected(current => current.includes(shareId)
      ? current.filter(id => id !== shareId)
      : current.length >= limit ? current : [...current, shareId]);
  }

  // 少于两个角色没有可比的：这块整体不渲染，不留一个点不动的入口。
  if (candidates.length < 2) return null;

  const atLimit = selected.length >= limit;
  return (
    <Card>
      <CardHeader>
        <CardTitle>多角色对比</CardTitle>
        <CardDescription>最多同时对比 {limit} 个角色。每条结果独立显示，失败的那条可以单独重试，不会重新生成也不会再扣费。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-wrap gap-2">
          {candidates.map(item => {
            const checked = selected.includes(item.shareId);
            return (
              <li key={item.shareId}>
                <button
                  type="button"
                  aria-pressed={checked}
                  disabled={!checked && atLimit}
                  onClick={() => toggle(item.shareId)}
                  className={
                    'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 '
                    + (checked ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted-foreground hover:text-foreground')
                  }
                >
                  {item.characterName} · {item.title}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void compare(selected)} disabled={selected.length < 2} loading={loading}>
            开始对比
          </Button>
          <span className="text-xs text-muted-foreground">已选 {selected.length} / {limit}</span>
          {atLimit && <span className="text-xs text-muted-foreground">已达到上限，先取消一个再选别的角色。</span>}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {entries && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {entries.map(entry => entry.status === 'READY' ? (
              <section key={entry.shareId} className="space-y-2" aria-label={entry.result.characterName + '的结果'}>
                <div className="flex items-center gap-2">
                  <Badge variant="brand">{entry.result.characterName}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(entry.result.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
                <MirrorResultCard fields={entry.result} />
              </section>
            ) : (
              <section key={entry.shareId} aria-label="这一条没能打开">
                <Card className="h-full border-dashed">
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{entry.reason}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">其他角色不受影响；重试只重新读取这一条。</p>
                    <Button variant="outline" size="sm" loading={retrying === entry.shareId} onClick={() => void retry(entry.shareId)} leadingIcon={<RefreshCw aria-hidden className="h-4 w-4" />}>
                      重新读取这一条
                    </Button>
                  </CardContent>
                </Card>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
