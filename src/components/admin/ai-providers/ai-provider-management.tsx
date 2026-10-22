'use client';
import {useCallback,useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
import {useAdminAccess} from '../use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel} from '../admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {EmptyState} from '@/components/ui/empty-state';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {API} from '@/lib/api-paths';

type Provider={id:string;name:string;protocol:string;baseUrl:string;isActive:boolean;sortOrder:number;version:number;hasSecret:boolean};
type Draft={id?:string;name:string;baseUrl:string;protocol:string;isActive:boolean;sortOrder:number;version:number;apiKey:string;clearSecret:boolean;reason:string};
const blank=():Draft=>({name:'',baseUrl:'https://api.openai.com/v1',protocol:'OPENAI_COMPATIBLE',isActive:false,sortOrder:0,version:0,apiKey:'',clearSecret:false,reason:''});

export function AiProviderManagement(){
  const {token,permissions,loading}=useAdminAccess(),[rows,setRows]=useState<Provider[]>([]),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const canManage=permissions.includes('ai.providers.manage'),canSecrets=permissions.includes('ai.providers.secrets.manage'),canTest=permissions.includes('ai.providers.test');
  const request=useCallback(async(url:string,init?:RequestInit)=>{const response=await fetch(url,{...init,cache:'no-store',headers:{Authorization:`Bearer ${token}`,...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});const data=await response.json();if(!response.ok)throw Error(data.error||'AI供应商请求失败。');return data;},[token]);
  const load=useCallback(async()=>{if(!token)return;try{setRows(await request(API.admin.ai.providers));setError('');}catch(value){setError((value as Error).message);}},[request,token]);
  useEffect(()=>{void load();},[load]);
  function set<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(old=>old?{...old,[key]:value}:old);}
  async function save(event:React.FormEvent){event.preventDefault();if(!draft||busy)return;setBusy(true);setError('');setNotice('');try{const body={...draft,sortOrder:Number(draft.sortOrder)};const saved=await request(draft.id?`${API.admin.ai.providers}/${encodeURIComponent(draft.id)}`:API.admin.ai.providers,{method:draft.id?'PATCH':'POST',body:JSON.stringify(body)});setDraft(null);setNotice('供应商配置已保存。');await load();if(!saved.hasSecret&&draft.isActive)setNotice('配置已保存；启用前需要配置密钥。');}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  async function test(provider:Provider){if(busy)return;setBusy(true);setError('');setNotice('');try{const result=await request(`${API.admin.ai.providers}/${encodeURIComponent(provider.id)}/test`,{method:'POST'});setNotice(result.reachable?`连接可达（HTTP ${result.status}，${result.latencyMs}ms）；${result.authorized?'认证成功':'服务端未接受当前密钥'}`:`连接失败（${result.latencyMs}ms），请检查地址、密钥及服务端网络。`);}catch(value){setError((value as Error).message);}finally{setBusy(false);}}
  if(loading)return <AdminPage><AdminNotice tone="loading" title="正在读取管理权限…" /></AdminPage>;
  if(!token||!permissions.includes('ai.providers.read'))return <AdminPage><AdminNotice tone="denied" title="当前账号没有 AI 供应商查看权限。" /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader eyebrow="AI 与成本" title="AI 供应商" description="维护 OpenAI 兼容接口地址与连接密钥。密钥以 AES-256-GCM 加密保存在数据库，只显示配置状态；服务器需设置 64 位十六进制 AI_PROVIDER_ENCRYPTION_KEY。连接测试仅请求供应商模型列表，不发送聊天内容。" />
    {error&&<AdminNotice tone="error" title={error} className="break-words py-6" />}{notice&&<AdminNotice tone="success" title={notice} className="break-words py-6" />}
    <AdminPanel title="已登记供应商" description="列表只展示配置状态，密钥永不明文返回。" badge={<Badge>{rows.length}</Badge>} actions={canManage&&<Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={()=>{setDraft(blank());setError('');setNotice('');}}>新增供应商</Button>}>
      <div className="grid gap-3">{rows.map(provider=><article key={provider.id} className="min-w-0 rounded-xl border bg-card p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{provider.name} <Badge variant={provider.isActive?'success':'neutral'} className="ml-2">{provider.isActive?'已启用':'已停用'}</Badge></h3><p className="mt-2 break-all text-sm text-muted-foreground">{provider.baseUrl}</p><p className="mt-1 text-xs text-muted-foreground">OpenAI 兼容协议 · 密钥{provider.hasSecret?'已配置':'未配置'} · v{provider.version}</p></div><div className="flex flex-wrap gap-2">{canTest&&provider.hasSecret&&<Button size="sm" variant="outline" aria-label={`测试连接 ${provider.name}`} disabled={busy} onClick={()=>void test(provider)}>测试连接</Button>}{canManage&&<Button size="sm" variant="outline" aria-label={`编辑 ${provider.name}`} onClick={()=>{setDraft({...provider,apiKey:'',clearSecret:false,reason:''});setError('');setNotice('');}}>编辑</Button>}</div></div></article>)}</div>
      {rows.length===0&&<EmptyState title="尚未登记供应商" description="登记并启用至少一个 OpenAI 兼容接口，模型路由才能绑定。" />}
    </AdminPanel>
    {draft&&<AdminPanel title={draft.id?'编辑供应商':'新增供应商'} description="保存结果会写入审计，请填写操作理由。" actions={<Button size="sm" variant="ghost" onClick={()=>setDraft(null)}>取消</Button>}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
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
        </div>
        {canSecrets&&(
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm font-medium">{draft.id?'替换 API 密钥（留空保留现有密钥）':'API 密钥'}</span>
            <Input type="password" autoComplete="new-password" maxLength={4096} value={draft.apiKey} onChange={event=>set('apiKey',event.target.value)} required={!draft.id} />
          </label>
        )}
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          {draft.id&&canSecrets&&<label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.clearSecret} onChange={event=>{set('clearSecret',event.target.checked);if(event.target.checked)set('isActive',false);}}/>清除已保存的密钥并停用</label>}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={draft.isActive} onChange={event=>set('isActive',event.target.checked)}/>启用此供应商</label>
        </div>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium">操作理由</span>
          <Textarea required maxLength={300} rows={3} value={draft.reason} onChange={event=>set('reason',event.target.value)} />
        </label>
        <div className="sm:col-span-2"><Button type="submit" loading={busy}>保存供应商</Button></div>
      </form>
    </AdminPanel>}
  </AdminPage>;
}
