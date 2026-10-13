'use client';
import {useEffect, useState} from 'react';
import {auditLabels} from './accounts/types';
import {useAdminAccess} from './use-admin-access';

type Audit = {id: string; actorId: string; action: string; targetId: string; reason: string; changes: string; createdAt: string};
const actionNames: Record<string, string> = {...auditLabels, BOOTSTRAP_OWNER: '初始化所有者', SAVE_OPERATOR: '修改管理身份', CREATE_ROLE: '新增角色', UPDATE_ROLE: '修改角色', ACCOUNT_CLOSED: '注销管理账号'};
export function AdminAudit() {
  const {token, access, loading, error: accessError} = useAdminAccess();
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{items: Audit[]; total: number; pageSize: number} | null>(null);
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  useEffect(() => {
    setResult(null); setError(''); if (!token || !access?.audit) return;
    const controller = new AbortController(); setReading(true);
    void (async () => {
      try {const response = await fetch(`/api/admin/audit?page=${page}`, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: controller.signal}); const data = await response.json(); if (!response.ok) throw Error(data.error || '读取审计失败。'); if (!controller.signal.aborted) setResult(data);}
      catch (value) {if (!controller.signal.aborted) setError((value as Error).message);}
      finally {if (!controller.signal.aborted) setReading(false);}
    })();
    return () => controller.abort();
  }, [token, access?.audit, page, refresh]);
  if (loading) return <p role="status" className="p-6">正在读取管理权限…</p>;
  if (!token || !access?.audit) return <p role="alert" className="p-6">{accessError || '当前账号没有管理审计权限。'}</p>;
  return <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">管理操作审计</h1><button className="min-h-11 rounded-lg border px-4" disabled={reading} onClick={() => setRefresh(value => value + 1)}>刷新审计</button></div>
    {error && <p role="alert" className="text-red-400">{error}</p>}{reading && <p role="status">正在读取审计…</p>}
    {result && <><div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">时间</th><th className="p-3">操作</th><th className="p-3">操作人 / 对象</th><th className="p-3">理由及变更</th></tr></thead><tbody>{result.items.map(item => <tr key={item.id} className="border-b align-top"><td className="whitespace-nowrap p-3">{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td className="p-3">{actionNames[item.action] ?? item.action}</td><td className="max-w-64 break-all p-3"><p>{item.actorId}</p><p className="mt-1 text-muted-foreground">{item.targetId}</p></td><td className="max-w-xl break-words p-3"><p>{item.reason}</p><details className="mt-2"><summary className="cursor-pointer">查看修改内容</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{item.changes}</pre></details></td></tr>)}</tbody></table></div>
    {!result.total && <p>暂无管理操作记录。</p>}<div className="flex flex-wrap items-center gap-3"><span>共 {result.total} 条 · 第 {page} 页</span><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={reading || page === 1} onClick={() => setPage(page - 1)}>上一页</button><button className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={reading || page * result.pageSize >= result.total} onClick={() => setPage(page + 1)}>下一页</button></div></>}
  </main>;
}
