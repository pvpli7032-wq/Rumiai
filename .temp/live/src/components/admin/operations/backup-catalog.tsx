'use client';
import {useEffect,useState} from 'react';
import type {BackupInventoryItem} from '@/lib/operations/backup-inventory';

type Catalog={items:BackupInventoryItem[];activeRestore:BackupInventoryItem|null;page:number;pageSize:number;total:number};
const kinds={DATABASE:'数据库文件',STATE_BACKUP:'联合备份',STATE_RESTORE:'隔离恢复'};
const checks={NOT_RECORDED:'无校验记录',RECORDED_AT_OPERATION:'操作时已校验',INCOMPLETE:'文件不完整',INVALID_METADATA:'清单异常'};
const reasons:Record<string,string>={MANIFEST_OR_DATABASE_MISSING:'缺少数据库或清单',DATA_FILES_INCOMPLETE:'数据文件与清单不符',METADATA_INVALID:'清单损坏或恢复记录不匹配',METADATA_TOO_LARGE:'清单超过8 MiB，请使用CLI检查',EMPTY_DATABASE:'数据库文件为空'};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN');
function bytes(value:number|null){if(value===null)return '—';const units=['B','KiB','MiB','GiB','TiB'];let unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return `${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(value)} ${units[unit]}`;}

export function BackupCatalog({token}:{token:string}){
  const [catalog,setCatalog]=useState<Catalog|null>(null),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setCatalog(null);setError('');setLoading(true);
    void fetch(`/api/admin/operations/backups?page=${page}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'备份记录读取失败。');if(!controller.signal.aborted)setCatalog(data);}).catch(value=>{if(!controller.signal.aborted)setError(value.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[token,page,revision]);
  return <section aria-labelledby="backup-catalog-title" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="backup-catalog-title" className="text-lg font-semibold">备份与隔离恢复记录</h2><button type="button" disabled={loading} onClick={()=>setRevision(value=>value+1)} className="min-h-11 rounded-lg border px-3 text-sm">刷新备份记录</button></div>
    <p className="text-sm text-muted-foreground">按本机文件修改时间分页展示，只读取清单元数据。校验栏是操作完成时的记录；当前完整性须通过CLI重新核验，服务切换及完整业务回滚另行验收。</p>
    {loading&&<p role="status">正在读取备份记录…</p>}{error&&<p role="alert" className="text-red-400">{error}</p>}
    {catalog?.activeRestore&&<div className="space-y-2 rounded-lg border p-3 text-sm"><h3 className="font-medium">当前数据库目录中的恢复记录</h3><p>{checks[catalog.activeRestore.verification]}{catalog.activeRestore.verification==='RECORDED_AT_OPERATION'&&(' · '+time(catalog.activeRestore.recordedAt))}</p><p className="text-muted-foreground">{catalog.activeRestore.verification==='RECORDED_AT_OPERATION'?'这是当时隔离复制与校验的记录，后续业务写入不改变该历史结果。':'恢复记录不完整或不可读，请由运维人员重新核查。'}</p></div>}
    {catalog&&<><div className="max-w-full overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm"><thead><tr className="border-b"><th className="p-3">类型</th><th className="p-3">记录时间</th><th className="p-3">数据库体积</th><th className="p-3">上传文件 / 体积</th><th className="p-3">引用数</th><th className="p-3">校验记录</th></tr></thead><tbody>{catalog.items.map(item=><tr key={item.id} data-backup-id={item.id} className="border-b align-top"><td className="whitespace-nowrap p-3">{kinds[item.kind]}</td><td className="whitespace-nowrap p-3">{time(item.recordedAt)}</td><td className="p-3">{bytes(item.databaseBytes)}</td><td className="p-3">{item.uploadCount??'—'} / {bytes(item.uploadBytes)}</td><td className="p-3">{item.referenceCount??'—'}</td><td className="max-w-64 p-3"><p className={['INCOMPLETE','INVALID_METADATA'].includes(item.verification)?'text-amber-500':''}>{checks[item.verification]}</p>{item.reasonCode&&<p className="mt-1 text-xs text-muted-foreground">{reasons[item.reasonCode]??'记录暂不可读'}</p>}</td></tr>)}</tbody></table></div>{!catalog.total&&<p className="text-sm text-muted-foreground">本机尚无备份候选记录。</p>}<div className="flex flex-wrap items-center gap-3 text-sm"><span>共 {catalog.total} 条 · 第 {catalog.page} 页</span><button disabled={loading||page<=1} onClick={()=>setPage(value=>value-1)} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">上一页备份</button><button disabled={loading||page*catalog.pageSize>=catalog.total} onClick={()=>setPage(value=>value+1)} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">下一页备份</button></div></>}
  </section>;
}
