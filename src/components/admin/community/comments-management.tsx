'use client';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Search} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {apiFetch} from '@/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Select} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {Pagination} from '@/components/ui/pagination';

type CommentRow = {id: string; postId: string; content: string; imageUrl: string | null; status: string; updatedAt: string; author: {username: string; displayName: string | null}; post: {id: string; circle: {id: string; name: string}}};
type Result = {items: CommentRow[]; total: number; page: number; pageSize: number};
export function CommentsManagement() {
  const {token, permissions, loading, error: accessError} = useAdminAccess(), allowed = permissions.includes('community.read'), canEdit = permissions.includes('community.write');
  const [queryText, setQueryText] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<{row: CommentRow; action: 'HIDE'|'RESTORE'|'DELETE'}|null>(null), [reason, setReason] = useState('');
  const request = useCallback(<T,>(url: string, init?: {method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal}) => apiFetch<T>(url, {token, cache: 'no-store', ...init}), [token]);
  useEffect(() => {setResult(null); if (!token || !allowed) return; const controller = new AbortController(), params = new URLSearchParams({q: query, status, page: String(page)}); void request<Result>(`/api/admin/community/comments?${params}`, {signal: controller.signal}).then(data => {if (!controller.signal.aborted) setResult(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}); return () => controller.abort();}, [request, token, allowed, query, status, page, revision]);
  function search(event: FormEvent) {event.preventDefault(); setPage(1); setQuery(queryText); setRevision(value => value + 1);}
  async function apply(event: FormEvent) {event.preventDefault(); if (!pending || busy || !reason.trim()) return; setBusy(true); setError(''); try {await request(`/api/admin/community/comments/${encodeURIComponent(pending.row.id)}`, {method: 'PATCH', body: {action: pending.action, reason: reason.trim(), updatedAt: pending.row.updatedAt}}); setMessage('评论处置已记录。'); setPending(null); setReason(''); setRevision(value => value + 1);} catch (value) {setError((value as Error).message); setRevision(value => value + 1);} finally {setBusy(false);}}
  if (loading) return <AdminPage><AdminNotice tone="loading" title="正在读取社区管理权限…" /></AdminPage>;
  if (!token || !allowed) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有社区管理查看权限。'} /></AdminPage>;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <AdminPage>
      <AdminPageHeader eyebrow="内容与社区" title="评论管理" description="检索公开、隐藏和已清除的评论，操作要求填写理由并写入审计。" />
      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {message && <AdminNotice tone="success" title={message} className="py-6" />}

      <AdminPanel title="筛选检索" description="支持按评论内容、作者、帖子编号或圈子检索。">
        <form onSubmit={search} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <label className="space-y-1.5 text-sm font-medium text-foreground">搜索评论
            <Input value={queryText} maxLength={100} onChange={event => setQueryText(event.target.value)} placeholder="评论、作者、帖子编号或圈子" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">状态
            <Select aria-label="评论状态" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}>
              <option value="ALL">全部</option>
              <option value="VISIBLE">公开</option>
              <option value="HIDDEN">已下架</option>
              <option value="DELETED">已清除</option>
            </Select>
          </label>
          <Button type="submit" leadingIcon={<Search className="h-4 w-4" />} className="self-end">搜索</Button>
        </form>
      </AdminPanel>

      <AdminPanel title="评论列表" badge={result && <Badge>{result.total} 条</Badge>}>
        {result ? (
          result.items.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">没有匹配的评论。</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {result.items.map(row => (
                <article key={row.id} className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="break-words text-sm font-semibold text-foreground">{row.post.circle.name} · {row.author.displayName || row.author.username}</p>
                    <Badge variant={row.status === 'VISIBLE' ? 'success' : row.status === 'HIDDEN' ? 'warning' : 'danger'}>{row.status === 'VISIBLE' ? '公开' : row.status === 'HIDDEN' ? '已下架' : '已清除'}</Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">评论 {row.id} · 帖子 {row.post.id}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{row.content || '（内容已清除）'}</p>
                  {row.imageUrl && <img src={row.imageUrl} alt="评论附件" className="max-h-64 max-w-full rounded-lg object-contain" />}
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      {row.status === 'VISIBLE' && <Button size="sm" variant="outline" onClick={() => {setPending({row, action: 'HIDE'}); setReason('');}}>下架</Button>}
                      {row.status === 'HIDDEN' && <Button size="sm" variant="outline" onClick={() => {setPending({row, action: 'RESTORE'}); setReason('');}}>恢复</Button>}
                      {row.status !== 'DELETED' && <Button size="sm" variant="danger" onClick={() => {setPending({row, action: 'DELETE'}); setReason('');}}>清除内容</Button>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )
        ) : (
          <AdminNotice tone="loading" title="正在读取评论…" />
        )}
        {result && result.total > 0 && (
          <Pagination page={page} pageCount={pageCount} onPageChange={value => setPage(value)} summary={`共 ${result.total} 条`} disabled={busy} className="mt-5" />
        )}
      </AdminPanel>

      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={`确认${pending?.action === 'HIDE' ? '下架' : pending?.action === 'RESTORE' ? '恢复' : '清除内容'}`}
        description={pending ? `处置会写入审计，请填写可追溯的理由。目标评论 ${pending.row.id}。` : undefined}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button>
            <Button type="submit" form="comment-action-form" disabled={busy || !reason.trim()}>{busy ? '处理中…' : '确认处置'}</Button>
          </>
        }
      >
        <form id="comment-action-form" onSubmit={apply}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">操作理由</span>
            <Textarea required maxLength={500} rows={4} value={reason} onChange={event => setReason(event.target.value)} />
          </label>
        </form>
      </Dialog>
    </AdminPage>
  );
}
