'use client';
import {useCallback,useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {EmptyState} from '@rumiai/ui/empty-state';
import {Input} from '@rumiai/ui/input';
import {Select} from '@rumiai/ui/select';
import {Textarea} from '@rumiai/ui/textarea';
import {API} from '@rumiai/contracts/api-paths';
import {DetailDrawer,DetailSection} from '../layout/detail-drawer';
import {Dialog} from '@rumiai/ui/dialog';

type Provider={id:string;name:string;protocol:string;baseUrl:string;isActive:boolean;sortOrder:number;version:number;hasSecret:boolean;references?:{models:number;activeModels:number};blockers?:Array<'ACTIVE'|'MODELS'>;canDelete?:boolean};
type Draft={id?:string;name:string;baseUrl:string;protocol:string;isActive:boolean;sortOrder:number;version:number;apiKey:string;clearSecret:boolean;reason:string};
const blank=():Draft=>({name:'',baseUrl:'https://api.openai.com/v1',protocol:'OPENAI_COMPATIBLE',isActive:false,sortOrder:0,version:0,apiKey:'',clearSecret:false,reason:''});

export function AiProviderManagement(){
  const {sessionActive,permissions,loading}=useAdminAccess(),[rows,setRows]=useState<Provider[]>([]),[statusFilter,setStatusFilter]=useState('ALL'),[draft,setDraft]=useState<Draft|null>(null),[draftBaseline,setDraftBaseline]=useState(''),[discardOpen,setDiscardOpen]=useState(false),[deleting,setDeleting]=useState<Provider|null>(null),[checkingDelete,setCheckingDelete]=useState(false),[deleteChecked,setDeleteChecked]=useState(false),[deleteReason,setDeleteReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const canManage=permissions.includes('ai.providers.manage'),canSecrets=permissions.includes('ai.providers.secrets.manage'),canTest=permissions.includes('ai.providers.test');
  const request=useCallback(async(url:string,init?:RequestInit)=>{const response=await fetch(url,{...init,cache:'no-store',headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});const data=await response.json();if(!response.ok)throw Error(data.error||'AI供应商请求失败。');return data;},[sessionActive]);
  useEffect(()=>{if(draft&&!draftBaseline)setDraftBaseline(JSON.stringify(draft));},[draft,draftBaseline]);
  const load=useCallback(async()=>{if(!sessionActive)return;try{setRows(await request(API.admin.ai.providers));setError('');}catch(value){setError((value as Error).message);}},[request,sessionActive]);
  useEffect(()=>{void load();},[load]);
  function set<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(old=>old?{...old,[key]:value}:old);}
  function openDraft(value:Draft){setDraft(value);setDraftBaseline(JSON.stringify(value));setError('');setNotice('');}
  function editProvider(provider:Provider){setDeleting(null);openDraft({id:provider.id,name:provider.name,baseUrl:provider.baseUrl,protocol:provider.protocol,isActive:provider.isActive,sortOrder:provider.sortOrder,version:provider.version,apiKey:'',clearSecret:false,reason:''});}
  function requestClose(){if(!draft)return;if(!draftBaseline||JSON.stringify(draft)!==draftBaseline){setDiscardOpen(true);return;}setDraft(null);setDraftBaseline('');}
  async function save(event:React.FormEvent){event.preventDefault();if(!draft||busy)return;setBusy(true);setError('');setNotice('');try{const body={...draft,sortOrder:Number(draft.sortOrder)};await request(draft.id?`${API.admin.ai.providers}/${encodeURIComponent(draft.id)}`:API.admin.ai.providers,{method:draft.id?'PATCH':'POST',body:JSON.stringify(body)});setDraft(null);setDraftBaseline('');await load();}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  async function test(provider:Provider){if(busy)return;setBusy(true);setError('');setNotice('');try{const result=await request(`${API.admin.ai.providers}/${encodeURIComponent(provider.id)}/test`,{method:'POST'});setNotice(result.reachable?`连接可达（HTTP ${result.status}，${result.latencyMs}ms）；${result.authorized?'认证成功':'服务端未接受当前密钥'}`:`连接失败（${result.latencyMs}ms），请检查地址、密钥及服务端网络。`);}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  async function remove(provider:Provider){if(busy||!canManage)return;setDeleting(provider);setDeleteReason('');setError('');setDeleteChecked(false);setCheckingDelete(true);try{setDeleting(await request(`${API.admin.ai.providers}/${encodeURIComponent(provider.id)}`));setDeleteChecked(true);}catch(value){setError((value as Error).message);}finally{setCheckingDelete(false);}}
  async function confirmRemove(){if(!deleting||!deleteReason.trim()||busy)return;setBusy(true);setError('');setNotice('');try{await request(`${API.admin.ai.providers}/${encodeURIComponent(deleting.id)}`,{method:'DELETE',body:JSON.stringify({version:deleting.version,reason:deleteReason.trim()})});setDeleting(null);setNotice('供应商已删除。');await load();}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  if(loading)return <AdminPage><AdminNotice tone="loading" title="正在读取管理权限…" /></AdminPage>;
  if(!sessionActive||!permissions.includes('ai.providers.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有 AI 供应商查看权限。" /></AdminPage>;
  const visibleRows=rows.filter(provider=>statusFilter==='ALL'||statusFilter==='ACTIVE'&&provider.isActive||statusFilter==='INACTIVE'&&!provider.isActive);
  const deleteBlocked=!deleteChecked||Boolean(deleting&&(deleting.isActive||(deleting.references?.models??0)>0));
  return <AdminPage>
    <AdminPageHeader eyebrow="AI 与成本" title="AI 供应商" description="维护 OpenAI 兼容接口地址与连接密钥。密钥以 AES-256-GCM 加密保存在数据库，只显示配置状态；服务器需设置 64 位十六进制 AI_PROVIDER_ENCRYPTION_KEY。连接测试仅请求供应商模型列表，不发送聊天内容。" />
    {error&&<AdminNotice tone="error" title={error} className="break-words py-6" />}{notice&&<AdminNotice tone="success" title={notice} className="break-words py-6" />}
    <AdminPanel title="已登记供应商" description="列表只展示配置状态，密钥永不明文返回。删除入口会先从服务器重新检查状态、版本与模型引用。" badge={<Badge>{visibleRows.length} / {rows.length}</Badge>} actions={<div className="flex flex-wrap items-center gap-2"><Select aria-label="供应商状态筛选" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="ALL">全部状态</option><option value="ACTIVE">已启用</option><option value="INACTIVE">已停用</option></Select>{canManage&&<Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={()=>openDraft(blank())}>新增供应商</Button>}</div>}>
      {!canManage&&<AdminNotice tone="info" title="当前账号为只读权限" description="可以查看供应商状态和引用数量，但不能编辑或删除。" className="mb-3" />}
      <div className="grid gap-3">{visibleRows.map(provider=><article key={provider.id} className="min-w-0 rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-shadow hover:shadow-md"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold tracking-tight">{provider.name} <Badge variant={provider.isActive?'success':'neutral'} className="ml-2">{provider.isActive?'已启用':'已停用'}</Badge></h3><p className="mt-2 break-all text-sm text-muted-foreground">{provider.baseUrl}</p><p className="mt-1 text-xs text-muted-foreground">OpenAI 兼容协议 · 密钥{provider.hasSecret?'已配置':'未配置'} · v{provider.version}</p><p className="mt-2 text-xs text-muted-foreground">删除依赖：模型 {provider.references?.models??'—'} 个（启用 {provider.references?.activeModels??'—'} 个）；存在模型引用时保留停用配置。</p></div><div className="flex flex-wrap gap-2">{canTest&&provider.hasSecret&&<Button size="sm" variant="outline" aria-label={`测试连接 ${provider.name}`} disabled={busy} onClick={()=>void test(provider)}>测试连接</Button>}{canManage&&<Button size="sm" variant="outline" aria-label={`编辑 ${provider.name}`} onClick={()=>editProvider(provider)}>编辑</Button>}{canManage&&<Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={()=>void remove(provider)}>删除 / 查看原因</Button>}</div></div></article>)}</div>
      {rows.length===0&&<EmptyState title="尚未登记供应商" description="登记并启用至少一个 OpenAI 兼容接口，模型路由才能绑定。" />}
      {rows.length>0&&visibleRows.length===0&&<EmptyState title="当前筛选没有供应商" description="切换状态筛选后查看其他配置。" />}
    </AdminPanel>
    {draft&&<DetailDrawer open={!!draft} onClose={()=>{if(!busy)requestClose();}} title={draft.id?'编辑供应商':'新增供应商'} description="保存结果会写入审计；停用配置可保留，启用前必须配置 API 密钥。" size="lg" footer={<><Button variant="ghost" disabled={busy} onClick={requestClose}>取消</Button><Button type="submit" form="ai-provider-form" loading={busy}>保存供应商</Button></>}>
      <form id="ai-provider-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">{error&&<AdminNotice tone="error" title={error} className="sm:col-span-2"/>}
        <DetailSection title="基本连接配置" className="sm:col-span-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">供应商名称</span>
          <Input required maxLength={60} value={draft.name} onChange={event=>set('name',event.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">排序值</span>
          <Input type="number" min={0} max={100000} step={1} value={draft.sortOrder} onChange={event=>set('sortOrder',Number(event.target.value))} />
        </label>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">API 基础地址</span>
            <Input required maxLength={300} type="url" placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={event=>set('baseUrl',event.target.value)} />
          </label>
          {/* 说明文字不能塞进 label：label 的文本就是控件的可访问名，混在一起会污染表单标签。 */}
          <p className="text-xs text-muted-foreground">仅允许公开 HTTPS 域名；不可填写本机地址、IP 地址或带有查询参数的 URL。</p>
        </div></DetailSection>
        <DetailSection title="密钥与状态" className="sm:col-span-2">
        {canSecrets&&(
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm font-medium">{draft.id?'替换 API 密钥（留空保留现有密钥）':'API 密钥'}</span>
            <Input type="password" autoComplete="new-password" maxLength={4096} value={draft.apiKey} onChange={event=>set('apiKey',event.target.value)} required={draft.isActive&&!draft.id} />
          </label>
        )}
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          {draft.id&&canSecrets&&<label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.clearSecret} onChange={event=>{set('clearSecret',event.target.checked);if(event.target.checked)set('isActive',false);}}/>清除已保存的密钥并停用</label>}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={event=>set('isActive',event.target.checked)}/>启用此供应商</label>
        </div>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium">操作理由</span>
          <Textarea required maxLength={300} rows={3} value={draft.reason} onChange={event=>set('reason',event.target.value)} />
        </label></DetailSection>
      </form>
    </DetailDrawer>}
    <Dialog open={discardOpen} onClose={()=>setDiscardOpen(false)} title="放弃未保存修改" description="当前抽屉中有未保存的修改，关闭后将丢失。" size="sm" footer={<><Button variant="ghost" onClick={()=>setDiscardOpen(false)}>继续编辑</Button><Button variant="danger" onClick={()=>{setDiscardOpen(false);setDraft(null);setDraftBaseline('');}}>放弃修改</Button></>}><p className="text-sm text-muted-foreground">如果只是暂时离开，选择“继续编辑”即可保留当前草稿。</p></Dialog>
    <Dialog open={!!deleting} onClose={()=>{if(!busy&&!checkingDelete)setDeleting(null);}} title="删除 AI 供应商" description="删除前已从服务器重新检查当前状态、版本和模型引用；服务端会在确认时再次检查。" size="md" footer={<><Button variant="ghost" disabled={busy||checkingDelete} onClick={()=>setDeleting(null)}>取消</Button>{deleteChecked&&deleting?.isActive&&<Button variant="outline" disabled={busy||checkingDelete} onClick={()=>editProvider(deleting)}>编辑并停用</Button>}{deleteChecked&&Boolean((deleting?.references?.models??0)>0)&&<Button variant="outline" disabled={busy||checkingDelete} onClick={()=>{window.location.assign(`/admin/ai/models?providerId=${encodeURIComponent(deleting!.id)}`);}}>查看关联模型</Button>}<Button variant="danger" loading={busy} disabled={busy||checkingDelete||deleteBlocked||!deleteReason.trim()} onClick={()=>void confirmRemove()}>确认删除</Button></>}>
      {deleting&&<div className="space-y-3">{checkingDelete&&<AdminNotice tone="loading" title="正在重新检查删除条件…" />}{error&&<AdminNotice tone="error" title={error} action={!checkingDelete?<Button variant="outline" size="sm" onClick={()=>void remove(deleting)}>重新检查</Button>:undefined}/>}<p className="text-sm">将删除：<strong>{deleting.name}</strong></p>{deleteChecked&&deleting.isActive&&<AdminNotice tone="warning" title="当前供应商仍在启用" description="请先编辑并停用；若仍有启用模型，保存时会明确要求先调整模型。" />}{deleteChecked&&Boolean((deleting.references?.models??0)>0)&&<AdminNotice tone="warning" title={`仍有关联模型 ${deleting.references?.models??0} 个`} description={`其中启用 ${deleting.references?.activeModels??0} 个。请查看关联模型并迁移运行配置；有历史引用的停用模型应保留，不清理历史来强制删除。`} />}{deleteChecked&&!deleteBlocked&&!checkingDelete&&<AdminNotice tone="success" title="当前满足删除条件" description="确认后只删除此未使用配置，历史调用与审计记录不会被删除。" />}<label className="block space-y-1.5"><span className="text-sm font-medium">删除理由</span><Textarea required maxLength={300} rows={3} disabled={deleteBlocked||checkingDelete} value={deleteReason} onChange={event=>setDeleteReason(event.target.value)} placeholder={!deleteChecked?'先完成服务器检查':deleteBlocked?'先处理上方阻止条件':'请说明删除原因'} /></label></div>}
    </Dialog>
  </AdminPage>;
}
