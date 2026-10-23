'use client';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {RefreshCw, Search} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {apiFetch} from '@admin/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {Dialog} from '@rumiai/ui/dialog';
import {Input} from '@rumiai/ui/input';
import {Select} from '@rumiai/ui/select';
import {Textarea} from '@rumiai/ui/textarea';
import {Pagination} from '@rumiai/ui/pagination';
import {DetailDrawer, DetailRow, DetailSection} from '@admin/components/layout/detail-drawer';

type Row = {id: string; content: string; status: string; isPinned: boolean; isFeatured: boolean; createdAt: string; updatedAt: string; media: {id: string; url: string; position: number}[]; author: {id: string; username: string; displayName: string | null}; circle: {id: string; name: string}; _count: {comments: number}};
type Result = {items: Row[]; total: number; page: number; pageSize: number};
const actions = [{id: 'HIDE', label: '下架'}, {id: 'RESTORE', label: '恢复'}, {id: 'PIN', label: '置顶'}, {id: 'UNPIN', label: '取消置顶'}, {id: 'FEATURE', label: '推荐'}, {id: 'UNFEATURE', label: '取消推荐'}, {id: 'DELETE', label: '清除内容'}] as const;
type Action = typeof actions[number]['id'];

/** 每个动作在什么状态下才可用，集中一处，列表不散落判断。 */
function actionAvailable(action: Action, row: Row): boolean {
  if (action === 'DELETE') return row.status !== 'DELETED';
  if (action === 'HIDE') return row.status === 'VISIBLE';
  if (action === 'RESTORE') return row.status === 'HIDDEN';
  if (action === 'PIN') return row.status === 'VISIBLE' && !row.isPinned;
  if (action === 'UNPIN') return row.isPinned;
  if (action === 'FEATURE') return row.status === 'VISIBLE' && !row.isFeatured;
  return row.isFeatured;
}

export function PostsManagement() {
  const {sessionActive, permissions, loading, error: accessError} = useAdminAccess(), allowed = permissions.includes('community.read'), canEdit = permissions.includes('community.write');
  const [queryText, setQueryText] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('ALL'), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<{row: Row; action: Action} | null>(null), [reason, setReason] = useState(''), [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const busyRef = useRef(false);
  const request = useCallback(<T,>(url: string, init?: {method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal}) => apiFetch<T>(url, {credentials: 'same-origin', cache: 'no-store', ...init}), [sessionActive]);
  useEffect(() => {setResult(null); setError(''); if (!sessionActive || !allowed) return; const controller = new AbortController(); const params = new URLSearchParams({q: query, status, page: String(page)}); void request<Result>(`/api/admin/community/posts?${params}`, {signal: controller.signal}).then(data => {if (!controller.signal.aborted) setResult(data);}).catch(value => {if (!controller.signal.aborted) setError(value.message);}); return () => controller.abort();}, [request, sessionActive, allowed, query, status, page, revision]);
  async function apply(event: FormEvent) {event.preventDefault(); if (!pending || busyRef.current || !reason.trim()) return; busyRef.current = true; setBusy(true); setError(''); setMessage(''); try {await request(`/api/admin/community/posts/${encodeURIComponent(pending.row.id)}`, {method: 'PATCH', body: {action: pending.action, reason: reason.trim(), updatedAt: pending.row.updatedAt}}); setMessage('处置已记录，列表正在刷新。'); setPending(null); setReason(''); setSelectedRow(null); setRevision(value => value + 1);} catch (value) {setError((value as Error).message); setRevision(value => value + 1);} finally {busyRef.current = false; setBusy(false);}}
  function search(event: FormEvent) {event.preventDefault(); setPage(1); setQuery(queryText); setRevision(value => value + 1);}
  if (loading) return <AdminPage><AdminNotice tone="loading" title="正在读取社区管理权限…" /></AdminPage>;
  if (!sessionActive || !allowed) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有社区管理查看权限。'} /></AdminPage>;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="内容与社区"
        title="帖子管理"
        description="按内容、作者和圈子检索帖子，记录每次下架、恢复、置顶和推荐理由。"
        actions={<Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新</Button>}
      />
      {error && <AdminNotice tone="error" title={error} className="py-6" />}
      {message && <AdminNotice tone="success" title={message} className="py-6" />}

      <AdminPanel className="border-border bg-card shadow-sm" title="筛选检索" description="支持按帖子内容、作者、圈子或帖子编号检索。">
        <form onSubmit={search} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <label className="space-y-1.5 text-sm font-medium text-foreground">搜索帖子
            <Input value={queryText} maxLength={100} onChange={event => setQueryText(event.target.value)} placeholder="内容、作者、圈子或帖子编号" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">状态
            <Select aria-label="帖子状态" value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}>
              <option value="ALL">全部</option>
              <option value="VISIBLE">公开</option>
              <option value="HIDDEN">已下架</option>
              <option value="DELETED">已清除</option>
            </Select>
          </label>
          <Button type="submit" leadingIcon={<Search className="h-4 w-4" />} className="self-end">搜索</Button>
        </form>
      </AdminPanel>

      <AdminPanel className="border-border bg-card shadow-sm" title="帖子列表" badge={result && <Badge>{result.total} 条</Badge>}>
        {result ? (
          result.items.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">没有匹配的帖子。</p>
          ) : (
            <div className="space-y-4">
              {result.items.map(row => (
                <article key={row.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/20 p-4 transition-colors hover:border-brand/30 hover:bg-brand-soft/15">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-foreground">{row.circle.name} · {row.author.displayName || row.author.username}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{row.id} · {new Date(row.updatedAt).toLocaleString('zh-CN')}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={row.status === 'VISIBLE' ? 'success' : row.status === 'HIDDEN' ? 'warning' : 'danger'}>{row.status === 'VISIBLE' ? '公开' : row.status === 'HIDDEN' ? '已下架' : '已清除'}</Badge>
                      {row.isPinned && <Badge variant="brand">置顶</Badge>}
                      {row.isFeatured && <Badge variant="outline">推荐</Badge>}
                    </div>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">{row.content || '（内容已清除）'}</p>
                  {row.media.length > 0 && <div className="flex gap-2 overflow-hidden">{row.media.slice(0, 3).map(media => <img key={media.id} src={media.url} alt="帖子附件缩略图" loading="lazy" className="h-16 w-16 rounded-lg border border-border object-cover" />)}{row.media.length > 3 && <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-xs text-muted-foreground">+{row.media.length - 3}</span>}</div>}
                  <p className="text-xs text-muted-foreground">评论 {row._count.comments} · 附件 {row.media.length} · 帖子编号 {row.id}</p>
                  <Button size="sm" variant="outline" onClick={() => setSelectedRow(row)}>查看详情</Button>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      {actions.filter(action => actionAvailable(action.id, row)).map(action => (
                        <Button key={action.id} size="sm" variant={action.id === 'DELETE' ? 'danger' : 'outline'} disabled={busy} onClick={() => {setPending({row, action: action.id}); setReason(''); setError('');}}>{action.label}</Button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )
        ) : (
          <AdminNotice tone="loading" title="正在读取帖子…" />
        )}
        {result && result.total > 0 && (
          <Pagination page={page} pageCount={pageCount} onPageChange={value => setPage(value)} summary={`共 ${result.total} 条`} disabled={busy} className="mt-5" />
        )}
      </AdminPanel>

      <DetailDrawer open={Boolean(selectedRow)} onClose={() => setSelectedRow(null)} size="lg" title={selectedRow ? '帖子详情' : '帖子详情'} description={selectedRow ? `${selectedRow.circle.name} · ${selectedRow.author.displayName || selectedRow.author.username}` : undefined}>
        {selectedRow && <div className="space-y-6">
          <DetailSection title="帖子内容"><p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 p-4 text-sm">{selectedRow.content || '（内容已清除）'}</p>{selectedRow.media.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{selectedRow.media.map(media => <img key={media.id} src={media.url} alt="帖子附件预览" className="aspect-square rounded-lg border border-border object-contain" />)}</div>}</DetailSection>
          <DetailSection title="帖子信息"><div className="space-y-2"><DetailRow label="帖子编号">{selectedRow.id}</DetailRow><DetailRow label="作者">{selectedRow.author.displayName || selectedRow.author.username}</DetailRow><DetailRow label="圈子">{selectedRow.circle.name}</DetailRow><DetailRow label="评论数">{selectedRow._count.comments}</DetailRow><DetailRow label="状态">{selectedRow.status === 'VISIBLE' ? '公开' : selectedRow.status === 'HIDDEN' ? '已下架' : '已清除'}</DetailRow></div></DetailSection>
          {canEdit && <div className="flex flex-wrap gap-2 border-t border-border pt-4">{actions.filter(action => actionAvailable(action.id, selectedRow)).map(action => <Button key={action.id} size="sm" variant={action.id === 'DELETE' ? 'danger' : 'outline'} onClick={() => {setPending({row: selectedRow, action: action.id}); setReason('');}}>{action.label}</Button>)}</div>}
        </div>}
      </DetailDrawer>

      <Dialog
        open={Boolean(pending)}
        onClose={() => { if (reason.trim() && !window.confirm('已填写处置理由，确定关闭并丢弃吗？')) return; setPending(null); }}
        title={`确认${actions.find(action => action.id === pending?.action)?.label ?? '处置'}`}
        description={pending ? `${pending.row.circle.name} · ${pending.row.id}，处置理由会写入审计。` : undefined}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button>
            <Button type="submit" form="post-action-form" disabled={busy || !reason.trim()}>{busy ? '处理中…' : '确认处置'}</Button>
          </>
        }
      >
        <form id="post-action-form" onSubmit={apply}>
          {error && <AdminNotice tone="error" title={error} className="mb-4 py-4" />}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">操作理由</span>
            <Textarea required minLength={1} maxLength={500} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="填写可供后续审计的处置理由" />
          </label>
        </form>
      </Dialog>
    </AdminPage>
  );
}
