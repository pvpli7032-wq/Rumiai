'use client';
import {useEffect, useState} from 'react';
import {Filter, RefreshCw} from 'lucide-react';
import {auditLabels} from './accounts/types';
import {useAdminAccess} from './use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from './admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {DataTable} from '@/components/ui/data-table';
import {EmptyState} from '@/components/ui/empty-state';
import {Input} from '@/components/ui/input';

type Audit = {id: string; actorId: string; action: string; targetId: string; reason: string; changes: string; createdAt: string};
const actionNames: Record<string, string> = {...auditLabels, BOOTSTRAP_OWNER: '初始化所有者', SAVE_OPERATOR: '修改管理身份', CREATE_ROLE: '新增角色', UPDATE_ROLE: '修改角色', ACCOUNT_CLOSED: '注销管理账号', CHARACTER_CREATED: '新增角色', CHARACTER_EDITED: '修改角色内容', CHARACTER_APPROVED: '角色审核通过', CHARACTER_REJECTED: '角色退回或下架', CIRCLE_CREATED: '新增站点圈子', CIRCLE_SAVE: '修改圈子内容', CIRCLE_HIDE: '隐藏圈子', CIRCLE_RESTORE: '恢复圈子公开', CIRCLE_FEATURE: '推荐圈子', CIRCLE_UNFEATURE: '取消圈子推荐', CIRCLE_MEMBER_REMOVE: '移除圈子成员', CIRCLE_MEMBER_BLOCK: '限制圈子加入', CIRCLE_MEMBER_UNBLOCK: '解除圈子加入限制'};
export function AdminAudit() {
  const {sessionActive, access, loading, error: accessError} = useAdminAccess();
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const emptyFilters={actorId:'',targetId:'',action:'',from:'',until:''};
  const [draft,setDraft]=useState(emptyFilters),[filters,setFilters]=useState(emptyFilters);
  const [result, setResult] = useState<{items: Audit[]; total: number; pageSize: number} | null>(null);
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  useEffect(() => {
    setResult(null); setError(''); if (!sessionActive || !access?.audit) return;
    const controller = new AbortController(); setReading(true);
    void (async () => {
      try {const params=new URLSearchParams({...filters,page:String(page)});const response = await fetch(`/api/admin/audit?${params}`, {credentials: 'include', cache: 'no-store', signal: controller.signal}); const data = await response.json(); if (!response.ok) throw Error(data.error || '读取审计失败。'); if (!controller.signal.aborted) setResult(data);}
      catch (value) {if (!controller.signal.aborted) setError((value as Error).message);}
      finally {if (!controller.signal.aborted) setReading(false);}
    })();
    return () => controller.abort();
  }, [sessionActive, access?.audit, page, refresh,filters]);
  if (loading) return <AdminPage><AdminNotice tone="loading" title="正在读取管理权限…" /></AdminPage>;
  if (!sessionActive || !access?.audit) return <AdminPage><AdminNotice tone="denied" title={accessError || '当前账号没有管理审计权限。'} /></AdminPage>;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="系统与安全"
        title="操作审计"
        description="权限变更、内容处置与合规配置调整全部留痕，可按操作人、对象或动作代码精确检索。"
        actions={<Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} disabled={reading} onClick={() => setRefresh(value => value + 1)}>刷新审计</Button>}
      />
      {error && <AdminNotice tone="error" title={error} className="py-6" />}

      <AdminPanel title="筛选条件" description="ID 与动作代码精确匹配；日期按 UTC 日统计，包含结束日期当天。" badge={<Badge>{result?.total ?? 0} 条</Badge>}>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={event=>{event.preventDefault();setPage(1);setFilters({...draft});}}>
          {([['actorId','操作人ID'],['targetId','对象ID'],['action','动作代码'],['from','开始日期（UTC）'],['until','结束日期（UTC）']] as const).map(([key,label])=>(
            <label key={key} className="min-w-0 space-y-1.5 text-sm font-medium text-foreground">{label}
              <Input type={key==='from'||key==='until'?'date':'text'} maxLength={100} value={draft[key]} onChange={event=>setDraft({...draft,[key]:event.target.value})} />
            </label>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit" leadingIcon={<Filter className="h-4 w-4" />} disabled={reading}>筛选审计</Button>
            <Button type="button" variant="ghost" disabled={reading} onClick={()=>{setDraft(emptyFilters);setFilters(emptyFilters);setPage(1);}}>重置筛选</Button>
          </div>
        </form>
      </AdminPanel>

      <DataTable
        rows={result?.items ?? []}
        getRowId={row => row.id}
        loading={reading}
        loadingRows={6}
        empty={<EmptyState title="暂无管理操作记录" description="调整筛选条件后重试。" />}
        columns={[
          {id: 'time', header: '时间', width: '180px', cell: row => <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>},
          {id: 'action', header: '操作', width: '160px', cell: row => <span className="font-medium">{actionNames[row.action] ?? row.action}</span>},
          {id: 'actor', header: '操作人 / 对象', width: '240px', cell: row => (
            <span className="block break-all">
              <span className="block">{row.actorId}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{row.targetId}</span>
            </span>
          )},
          {id: 'reason', header: '理由及变更', cell: row => (
            <span className="block break-words">
              <span className="block">{row.reason}</span>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">查看修改内容</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted-foreground">{row.changes}</pre>
              </details>
            </span>
          )},
        ]}
        pagination={result ? {page, pageCount, onPageChange: value => setPage(value), summary: `共 ${result.total} 条 · 第 ${page} 页`} : undefined}
      />
    </AdminPage>
  );
}
