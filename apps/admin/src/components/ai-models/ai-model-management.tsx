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

type Provider={id:string;name:string;isActive:boolean;hasSecret:boolean};
type Model={id:string;key:string;displayName:string;modelCode:string;providerId:string;provider:{id:string;name:string;isActive:boolean};isActive:boolean;isDefault:boolean;isFallback:boolean;sortOrder:number;timeoutMs:number;maxRetries:number;maxOutputTokens:number;lastCheckAt:string|null;lastCheckStatus:string|null;version:number;references?:{characterBindings:number;conversationBindings:number;modelPrices:number;coinPrices:number;aiCalls:number;taskSettings:number};canDelete?:boolean};
type Draft={id?:string;key:string;displayName:string;modelCode:string;providerId:string;isActive:boolean;isDefault:boolean;isFallback:boolean;sortOrder:number;timeoutMs:number;maxRetries:number;maxOutputTokens:number;version:number;reason:string};
const blank=(providers:Provider[]):Draft=>({key:'',displayName:'',modelCode:'',providerId:providers.find(item=>item.isActive&&item.hasSecret)?.id??providers[0]?.id??'',isActive:false,isDefault:false,isFallback:false,sortOrder:0,timeoutMs:30000,maxRetries:1,maxOutputTokens:800,version:0,reason:''});
const checkStatus:Record<string,string>={AVAILABLE:'可用',NOT_LISTED:'接口可达，模型未列出',REJECTED:'服务端拒绝认证',UNAVAILABLE:'连接失败'};

export function AiModelManagement(){
  const {sessionActive,permissions,loading}=useAdminAccess(),[rows,setRows]=useState<Model[]>([]),[providers,setProviders]=useState<Provider[]>([]),[draft,setDraft]=useState<Draft|null>(null),[draftBaseline,setDraftBaseline]=useState(''),[discardOpen,setDiscardOpen]=useState(false),[deleting,setDeleting]=useState<Model|null>(null),[deleteReason,setDeleteReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const canManage=permissions.includes('ai.models.manage'),canTest=permissions.includes('ai.models.test');
  const request=useCallback(async(url:string,init?:RequestInit)=>{const response=await fetch(url,{...init,cache:'no-store',headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});const data=await response.json();if(!response.ok)throw Error(data.error||'AI模型请求失败。');return data;},[sessionActive]);
  useEffect(()=>{if(draft&&!draftBaseline)setDraftBaseline(JSON.stringify(draft));},[draft,draftBaseline]);
  const load=useCallback(async()=>{if(!sessionActive)return;try{const [models,sources]=await Promise.all([request('/api/admin/ai/models'),request(API.admin.ai.providers)]);setRows(models);setProviders(sources);setError('');}catch(value){setError((value as Error).message);}},[request,sessionActive]);
  useEffect(()=>{void load();},[load]);
  function set<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(old=>old?{...old,[key]:value}:old);}
  function openDraft(value:Draft){setDraft(value);setDraftBaseline(JSON.stringify(value));setError('');setNotice('');}
  function requestClose(){if(!draft)return;if(!draftBaseline||JSON.stringify(draft)!==draftBaseline){setDiscardOpen(true);return;}setDraft(null);setDraftBaseline('');}
  async function save(event:React.FormEvent){event.preventDefault();if(!draft||busy)return;setBusy(true);setError('');setNotice('');try{const body={...draft,sortOrder:Number(draft.sortOrder),timeoutMs:Number(draft.timeoutMs),maxRetries:Number(draft.maxRetries),maxOutputTokens:Number(draft.maxOutputTokens)};await request(draft.id?`/api/admin/ai/models/${encodeURIComponent(draft.id)}`:'/api/admin/ai/models',{method:draft.id?'PATCH':'POST',body:JSON.stringify(body)});setDraft(null);setDraftBaseline('');await load();}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  async function test(model:Model){if(busy)return;setBusy(true);setError('');setNotice('');try{const result=await request(`/api/admin/ai/models/${encodeURIComponent(model.id)}/test`,{method:'POST'});setNotice(`${checkStatus[result.reachable?(result.authorized?(result.modelListed===false?'NOT_LISTED':'AVAILABLE'):'REJECTED'):'UNAVAILABLE']} · ${result.latencyMs}ms${result.status?` · HTTP ${result.status}`:''}`);await load();}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  function remove(model:Model){if(busy||!canManage)return;setDeleting(model);setDeleteReason('');setError('');}
  async function confirmRemove(){if(!deleting||!deleteReason.trim()||busy)return;setBusy(true);setError('');setNotice('');try{await request(`/api/admin/ai/models/${encodeURIComponent(deleting.id)}`,{method:'DELETE',body:JSON.stringify({version:deleting.version,reason:deleteReason.trim()})});setDeleting(null);setNotice('模型已删除。');await load();}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  if(loading)return <AdminPage><AdminNotice tone="loading" title="正在读取管理权限…" /></AdminPage>;
  if(!sessionActive||!permissions.includes('ai.models.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有 AI 模型查看权限。" /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader eyebrow="AI 与成本" title="模型与路由" description="将逻辑模型标识绑定到供应商实际模型代码。启用模型须绑定已启用且密钥可用的供应商；全站只能有一个默认模型，备用模型按排序依次尝试。聊天选择会保存逻辑标识，不会向客户端暴露供应商密钥。" />
    {error&&<AdminNotice tone="error" title={error} className="break-words py-6" />}{notice&&<AdminNotice tone="success" title={notice} className="break-words py-6" />}
    <AdminPanel title="模型目录" description="默认模型唯一，备用模型按排序值依次尝试。" badge={<Badge>{rows.length}</Badge>} actions={canManage&&<Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} disabled={!providers.length} onClick={()=>openDraft(blank(providers))}>新增模型</Button>}>
      <div className="grid gap-3">{rows.map(model=><article key={model.id} className="min-w-0 rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-shadow hover:shadow-md"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="flex flex-wrap items-center gap-2 font-semibold tracking-tight">{model.displayName}<Badge variant={model.isActive?'success':'neutral'}>{model.isActive?'已启用':'已停用'}</Badge>{model.isDefault&&<Badge variant="brand">默认</Badge>}{model.isFallback&&<Badge variant="outline">备用</Badge>}</h3><p className="mt-2 break-all text-sm text-muted-foreground">键：{model.key} · {model.provider.name} / {model.modelCode}</p><p className="mt-1 text-xs text-muted-foreground">超时 {model.timeoutMs}ms · 重试 {model.maxRetries} 次 · 输出上限 {model.maxOutputTokens} tokens · v{model.version}{model.lastCheckStatus?` · 检查：${checkStatus[model.lastCheckStatus]??model.lastCheckStatus}`:''}</p><p className="mt-2 text-xs text-muted-foreground">删除依赖：角色 {model.references?.characterBindings??'—'} 个 · 会话绑定 {model.references?.conversationBindings??'—'} 个 · 成本价格 {model.references?.modelPrices??'—'} 条 · 币价 {model.references?.coinPrices??'—'} 条 · AI 调用 {model.references?.aiCalls??'—'} 条 · 任务设置 {model.references?.taskSettings??'—'} 项。</p></div><div className="flex flex-wrap gap-2">{canTest&&<Button size="sm" variant="outline" aria-label={`检查模型 ${model.displayName}`} disabled={busy} onClick={()=>void test(model)}>检查模型</Button>}{canManage&&<Button size="sm" variant="outline" aria-label={`编辑 ${model.displayName}`} onClick={()=>{setDraft({id:model.id,key:model.key,displayName:model.displayName,modelCode:model.modelCode,providerId:model.providerId,isActive:model.isActive,isDefault:model.isDefault,isFallback:model.isFallback,sortOrder:model.sortOrder,timeoutMs:model.timeoutMs,maxRetries:model.maxRetries,maxOutputTokens:model.maxOutputTokens,version:model.version,reason:''});setError('');setNotice('');}}>编辑</Button>}{canManage&&<Button size="sm" variant="ghost" className="text-destructive" disabled={busy||model.isActive||model.isDefault||model.isFallback||model.canDelete===false} title={model.isActive?'请先停用模型':model.isDefault?'请先切换默认模型':model.isFallback?'请先取消备用路由':model.canDelete===false?'存在关联引用，无法删除':undefined} onClick={()=>void remove(model)}>删除</Button>}</div></div></article>)}</div>
      {rows.length===0&&<EmptyState title="尚未配置模型" description="先在 AI 供应商页面登记并启用连接，再回来绑定模型路由。" />}
    </AdminPanel>
    {draft&&<DetailDrawer open={!!draft} onClose={()=>{if(!busy)requestClose();}} title={draft.id?'编辑模型路由':'新增模型路由'} description="逻辑标识保存后不可更改；启用、默认和备用状态会参与删除保护。" size="lg" footer={<><Button variant="ghost" disabled={busy} onClick={requestClose}>取消</Button><Button type="submit" form="ai-model-form" loading={busy}>保存路由</Button></>}>
      <form id="ai-model-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">{error&&<AdminNotice tone="error" title={error} className="sm:col-span-2"/>}
        <DetailSection title="模型身份与供应商" className="sm:col-span-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">逻辑模型标识</span>
            <Input required maxLength={64} readOnly={Boolean(draft.id)} value={draft.key} onChange={event=>set('key',event.target.value)} placeholder="例如 role-chat-pro" />
          </label>
          {/* 说明文字不能塞进 label：label 的文本就是控件的可访问名，混在一起会污染表单标签。 */}
          <p className="text-xs text-muted-foreground">保存后固定不变，用于既有会话的模型选择。</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">前台显示名称</span>
          <Input required maxLength={80} value={draft.displayName} onChange={event=>set('displayName',event.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">供应商选择</span>
          {/* select 包在 label 里时，可访问名会被 option 文本污染，显式 aria-label 才是稳定名字。 */}
          <Select aria-label="供应商选择" required value={draft.providerId} onChange={event=>set('providerId',event.target.value)}>
            {providers.map(provider=><option key={provider.id} value={provider.id}>{provider.name}{provider.isActive&&provider.hasSecret?' · 可用':' · 未启用或密钥未配置'}</option>)}
          </Select>
        </label>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium">供应商模型代码</span>
          <Input required maxLength={120} value={draft.modelCode} onChange={event=>set('modelCode',event.target.value)} placeholder="由供应商提供的真实模型 ID" />
        </label></DetailSection>
        <DetailSection title="运行参数与路由状态" className="sm:col-span-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">单次连接超时（毫秒）</span>
          <Input type="number" min={1000} max={120000} step={1000} value={draft.timeoutMs} onChange={event=>set('timeoutMs',Number(event.target.value))} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">最大重试次数</span>
          <Input type="number" min={0} max={2} value={draft.maxRetries} onChange={event=>set('maxRetries',Number(event.target.value))} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">最大输出 Token</span>
          <Input type="number" min={1} max={200000} value={draft.maxOutputTokens} onChange={event=>set('maxOutputTokens',Number(event.target.value))} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">排序值</span>
          <Input type="number" min={0} max={100000} value={draft.sortOrder} onChange={event=>set('sortOrder',Number(event.target.value))} />
        </label>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={event=>set('isActive',event.target.checked)}/>启用模型</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isDefault} onChange={event=>set('isDefault',event.target.checked)}/>设为全站默认</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isFallback} onChange={event=>set('isFallback',event.target.checked)}/>备用路由</label>
        </div>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium">操作理由</span>
          <Textarea required maxLength={300} rows={3} value={draft.reason} onChange={event=>set('reason',event.target.value)} />
        </label></DetailSection>
      </form>
    </DetailDrawer>}
    <Dialog open={discardOpen} onClose={()=>setDiscardOpen(false)} title="放弃未保存修改" description="当前抽屉中有未保存的修改，关闭后将丢失。" size="sm" footer={<><Button variant="ghost" onClick={()=>setDiscardOpen(false)}>继续编辑</Button><Button variant="danger" onClick={()=>{setDiscardOpen(false);setDraft(null);setDraftBaseline('');}}>放弃修改</Button></>}><p className="text-sm text-muted-foreground">如果只是暂时离开，选择“继续编辑”即可保留当前草稿。</p></Dialog>
    <Dialog open={!!deleting} onClose={()=>{if(!busy)setDeleting(null);}} title="删除 AI 模型" description="仅允许删除已停用、非默认、非备用且没有历史引用的模型；历史价格与调用记录不会被删除。" size="md" footer={<><Button variant="ghost" disabled={busy} onClick={()=>setDeleting(null)}>取消</Button><Button variant="danger" loading={busy} disabled={busy||!deleteReason.trim()} onClick={()=>void confirmRemove()}>确认删除</Button></>}>
      {deleting&&<div className="space-y-3">{error&&<AdminNotice tone="error" title={error}/>}<p className="text-sm">将删除：<strong>{deleting.displayName}</strong>（{deleting.key}）</p><p className="text-xs text-muted-foreground">当前依赖：角色 {deleting.references?.characterBindings??0} 个 · 会话 {deleting.references?.conversationBindings??0} 个 · 成本价格 {deleting.references?.modelPrices??0} 条 · 币价 {deleting.references?.coinPrices??0} 条 · AI 调用 {deleting.references?.aiCalls??0} 条 · 任务设置 {deleting.references?.taskSettings??0} 项。</p><label className="block space-y-1.5"><span className="text-sm font-medium">删除理由</span><Textarea required maxLength={300} rows={3} value={deleteReason} onChange={event=>setDeleteReason(event.target.value)} placeholder="请说明删除原因" /></label></div>}
    </Dialog>
  </AdminPage>;
}
