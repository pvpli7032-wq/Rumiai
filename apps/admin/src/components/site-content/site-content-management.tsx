'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {Plus} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {ContentEditor} from './content-editor';
import {contentTypes, defaults, summary, type ContentType, type ManagedSiteContent, type Revision, type SiteContentRow} from './types';
import {apiFetch} from '@admin/lib/api-client';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {DataTable} from '@admin/components/layout/data-table';
import {EmptyState} from '@rumiai/ui/empty-state';
import {DetailDrawer} from '@admin/components/layout/detail-drawer';

const statusLabel = {PUBLISHED:'已发布',UNPUBLISHED:'已下架',DRAFT:'草稿',SCHEDULED:'定时'} as const;
const CONTENT_TABS: Record<string, ContentType> = {tag:'TAG',badge:'BADGE',section:'SECTION',navigation:'NAVIGATION',page:'PAGE',branding:'BRANDING'};
const TAB_BY_TYPE: Partial<Record<ContentType,string>> = {TAG:'tag',BADGE:'badge',SECTION:'section',NAVIGATION:'navigation',PAGE:'page',BRANDING:'branding'};
export function SiteContentManagement() {
  const router=useRouter(),searchParams=useSearchParams();
  const requestedType=searchParams.get('tab');
  const type:ContentType=requestedType&&CONTENT_TABS[requestedType]?CONTENT_TABS[requestedType]:'BANNER';
  const {sessionActive, permissions, loading: accessLoading, error: accessError} = useAdminAccess();
  const canRead = permissions.includes('site.content.read'), canManage = permissions.includes('site.content.manage'), canPublish = permissions.includes('site.content.publish');
  const [result,setResult] = useState<ManagedSiteContent|null>(null), [selected,setSelected] = useState<string|null>(null), [creating,setCreating] = useState(false);
  const [revision,setRevision] = useState(0), [revisions,setRevisions] = useState<Revision[]>([]), [revisionLoading,setRevisionLoading] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const [editorDirty,setEditorDirty] = useState(false);
  const busyRef = useRef(false);
  const request = useCallback(<T,>(url:string, init?:{method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal}) => apiFetch<T>(url,{credentials: 'same-origin',cache:'no-store',...init}),[sessionActive]);
  const selectType=useCallback((next:ContentType,replace=false)=>{const params=new URLSearchParams(searchParams.toString());const tab=TAB_BY_TYPE[next];if(tab)params.set('tab',tab);else params.delete('tab');const href=params.size?`/admin/site-content?${params}`:'/admin/site-content';if(replace)router.replace(href,{scroll:false});else router.push(href,{scroll:false});},[router,searchParams]);
  useEffect(()=>{if(requestedType&&!CONTENT_TABS[requestedType])selectType('BANNER',true);},[requestedType,selectType]);
  useEffect(()=>{setSelected(null);setCreating(false);setRevisions([]);setError('');setMessage('');},[type]);
  useEffect(()=>{setSelected(null);setCreating(false);setRevisions([]);setError('');setMessage('');},[sessionActive]);
  useEffect(()=>{setResult(null);if(!sessionActive||!canRead)return;const controller=new AbortController();void request<ManagedSiteContent>('/api/admin/site-content',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult(data);}).catch(value=>{if(!controller.signal.aborted)setError(value.message);});return()=>controller.abort();},[request,sessionActive,canRead,revision]);
  const rows=result?.[type].items??[];
  const item=useMemo(()=>selected?rows.find(row=>row.id===selected)??null:null,[rows,selected]);
  async function apply(action:'SAVE'|'SCHEDULE'|'PUBLISH'|'UNPUBLISH'|'DELETE_DRAFT',content:Record<string,unknown>,reason:string,scheduledAt?:string){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setMessage('');try{const body={action,content,reason,version:item?.version??0,...(scheduledAt?{scheduledAt}:{})};const saved=await request<SiteContentRow>(creating?`/api/admin/site-content/${type}`:`/api/admin/site-content/${type}/${encodeURIComponent(item!.id)}`,{method:creating?'POST':'PATCH',body:body});setCreating(false);setSelected(saved.id);setRevisions([]);setRevision(value=>value+1);setMessage(action==='SAVE'?'草稿已保存。':action==='SCHEDULE'?'定时发布已保存。':action==='UNPUBLISH'?'内容已下架。':action==='DELETE_DRAFT'?'草稿已丢弃。':'内容已发布。');}catch(value){setError((value as Error).message);setRevision(value=>value+1);}finally{busyRef.current=false;setBusy(false);}}
  async function loadRevisions(){if(!item)return;setRevisionLoading(true);setError('');try{setRevisions(await request(`/api/admin/site-content/${type}/${encodeURIComponent(item.id)}/revisions`));}catch(value){setError((value as Error).message);}finally{setRevisionLoading(false);}}
  async function restoreRevision(target:Revision,reason:string){if(!item||busyRef.current)return;if(!reason.trim()){setError('恢复版本前请填写操作理由。');return;}busyRef.current=true;setBusy(true);setError('');try{await request(`/api/admin/site-content/${type}/${encodeURIComponent(item.id)}/revisions/${encodeURIComponent(target.id)}/restore`,{method:'POST',body:{version:item.version,reason}});setRevisions([]);setRevision(value=>value+1);setMessage(`版本 ${target.version} 已恢复为草稿，发布前仍可检查。`);}catch(value){setError((value as Error).message);setRevision(value=>value+1);}finally{busyRef.current=false;setBusy(false);}}
  const closeEditor = useCallback(() => { if (busy) return; if (editorDirty && !window.confirm('当前内容有未保存修改，确定关闭并放弃吗？')) return; setEditorDirty(false); setCreating(false); setSelected(null); setRevisions([]); }, [busy, editorDirty]);
  if(accessLoading)return <AdminPage><AdminNotice tone="loading" title="正在读取站点内容权限…" /></AdminPage>;
  if(!sessionActive||!canRead)return <AdminPage><AdminNotice tone="denied" title={accessError||'当前账号没有站点内容查看权限。'} /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader eyebrow="增长与运营" title="站点内容" description="统一管理品牌主题、首页横幅、导航、固定页面与公告。页面只能使用当前支持的内容组件；修改先进入草稿，发布或定时生效后才展示给访客。配置键稳定后不能改名，避免已有角色和展示区引用失效。" />
    <AdminNotice tone="info" title="首页文案怎么改" description="首页横幅在「首页横幅」里配。首页主标题、副标题、两个行动按钮和「他眼中的你」入口卡片，在「固定页面与公告」里建一个页面路径为 home 的页面：第 1 个段落=主标题、第 2 个段落=副标题、第 1 个按钮=主按钮、第 2 个按钮=次按钮、第 1 张卡片=「他眼中的你」的标题、说明与按钮。没配的部分继续用内置多语言文案；导航与页脚在「导航与页脚」里配。" />
    {error&&<AdminNotice tone="error" title={error} className="py-6" />}
    {message&&<AdminNotice tone="success" title={message} className="py-6" />}
    <div className="flex flex-wrap gap-2">{contentTypes.map(option=>(
      <button
        key={option.id}
        type="button"
        aria-pressed={type===option.id}
        onClick={()=>selectType(option.id)}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-colors ${type===option.id?'border-brand/50 bg-brand-soft text-brand':'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}
      >
        {option.label}
        <span className="text-xs opacity-70">{result?.[option.id].items.length??'…'}</span>
      </button>
    ))}</div>
    <AdminPanel
      className="border-border bg-card shadow-sm"
      title={contentTypes.find(row=>row.id===type)?.label ?? '内容列表'}
      description="修改先进草稿，发布或定时生效后才对访客可见。"
      badge={<Badge>{rows.length} 条</Badge>}
      actions={canManage&&<Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} disabled={busy} onClick={()=>{setCreating(true);setSelected(null);setRevisions([]);setError('');}}>新增草稿</Button>}
    >
      {result ? <DataTable
        rows={rows}
        getRowId={row => row.id}
        empty={<EmptyState title="暂无内容" description="创建草稿并发布后才会进入前台。" />}
        rowClassName={row => (selected === row.id ? 'bg-brand-soft/40' : undefined)}
        columns={[
          {id: 'content', header: '内容', cell: row => {
            const content = row.content ?? {};
            return (
              <span className="block max-w-[30rem] break-words">
                <span className="block font-medium">{summary(type, content)}</span>
                <span className="mt-0.5 block break-all text-xs text-muted-foreground">{row.id}</span>
                {type === 'BANNER' && <span className="mt-1 block break-all text-xs text-muted-foreground">{String(content.href ?? '')}</span>}
              </span>
            );
          }},
          {id: 'status', header: '状态', width: '150px', cell: row => (
            <span className="block">
              <Badge variant={row.status === 'PUBLISHED' ? 'success' : row.status === 'DRAFT' ? 'neutral' : row.status === 'SCHEDULED' ? 'brand' : 'warning'}>{statusLabel[row.status]}</Badge>
              {row.scheduledAt && <span className="mt-1 block text-xs text-muted-foreground">{new Date(row.scheduledAt).toLocaleString('zh-CN')}</span>}
            </span>
          )},
          {id: 'sort', header: '排序', width: '90px', cell: row => String((row.content ?? {}).sortOrder ?? '')},
          {id: 'version', header: '版本/时间', width: '180px', cell: row => (
            <span className="block whitespace-nowrap">
              <span className="block text-xs text-muted-foreground">v{row.version}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN') : '暂无修改记录'}</span>
            </span>
          )},
          {id: 'actions', header: '操作', width: '130px', cell: row => (
            <Button size="sm" variant="outline" disabled={busy} onClick={()=>{setCreating(false);setSelected(row.id);setRevisions([]);setError('');}}>编辑与预览</Button>
          )},
        ]}
      /> : <AdminNotice tone="loading" title="正在读取站点内容…" />}
    </AdminPanel>
    <DetailDrawer open={Boolean(creating||item)} onClose={closeEditor} size="xl" title={creating ? '新增内容草稿' : '编辑站点内容'} description="内容编辑、预览、版本历史和发布操作集中在此处。">
      {(creating||item)&&<ContentEditor key={`${type}:${creating?'new':item!.id}:${item?.version??0}`} type={type} item={creating?{id:'',content:{...defaults[type]},status:'DRAFT',isPublished:false,scheduledAt:null,version:0,updatedAt:new Date().toISOString()}:item} canManage={canManage} canPublish={canPublish} busy={busy} revisions={revisions} revisionLoading={revisionLoading} onApply={apply} onRestore={restoreRevision} onLoadRevisions={()=>void loadRevisions()} onClose={closeEditor} onDirtyChange={setEditorDirty} externalError={error}/>}</DetailDrawer>
  </AdminPage>;
}
