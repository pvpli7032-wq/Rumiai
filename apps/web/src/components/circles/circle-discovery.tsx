'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useAuth} from '@web/lib/auth-context';
import {API} from '@rumiai/contracts/api-paths';
import {Dialog} from '@rumiai/ui';
type Circle={id:string;name:string;description:string;tags:string|null;owner:{id:string;username:string;displayName:string|null}|null;isFeatured:boolean;universe:{id:string;name:string}|null;subscriberCount:number;subscribed:boolean};
export function CircleDiscovery(){
 const {token,isLoading}=useAuth(); const params=useSearchParams(); const requestedSearch=params.get('search')??'';
 const [rows,setRows]=useState<Circle[]>([]),[scope,setScope]=useState(''),[search,setSearch]=useState(requestedSearch),[revision,setRevision]=useState(0);
 useEffect(()=>{setSearch(requestedSearch)},[requestedSearch]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 const [pendingUnsubscribe,setPendingUnsubscribe]=useState<Circle|null>(null);
 const [creating,setCreating]=useState(false),[name,setName]=useState(''),[description,setDescription]=useState(''),[tags,setTags]=useState('');
 const [universeId,setUniverseId]=useState(''),[universes,setUniverses]=useState<{id:string;name:string}[]>([]);
 useEffect(()=>{const controller=new AbortController();fetch(API.universes,{signal:controller.signal}).then(r=>r.ok?r.json():[]).then(data=>{if(Array.isArray(data))setUniverses(data)}).catch(()=>{});return()=>controller.abort()},[]);
 useEffect(()=>{
  setRows([]);setError('');setLoading(true);if(isLoading)return;
  if(scope&&!token){setLoading(false);return}
  const controller=new AbortController();const timer=setTimeout(()=>{
   const params=new URLSearchParams({search});if(scope)params.set('scope',scope);
   fetch('/api/circles?'+params,{signal:controller.signal,headers:token?{Authorization:'Bearer '+token}:{}}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data}).then(data=>{if(!controller.signal.aborted)setRows(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'加载失败，请重试。')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  },200);return()=>{clearTimeout(timer);controller.abort()};
 },[token,isLoading,scope,search,revision]);
 async function subscribe(circle:Circle,confirmed=false){
  if(!token||busy)return;if(circle.subscribed&&!confirmed){setPendingUnsubscribe(circle);return;}setBusy(circle.id);setNotice('');
  try{const r=await fetch('/api/circles/'+circle.id+'/subscription',{method:circle.subscribed?'DELETE':'PUT',headers:{Authorization:'Bearer '+token}});const data=await r.json();if(!r.ok)throw Error(data.error);setRows(current=>current.map(row=>row.id===circle.id?{...row,...data}:row).filter(row=>scope!=='subscribed'||row.subscribed));setNotice(data.subscribed?'已订阅圈子。':'已取消订阅。')}
  catch(e){setNotice(e instanceof Error?e.message:'网络连接失败，请重试。')}finally{setBusy('')}
 }
 async function create(event:React.FormEvent){
  event.preventDefault();if(!token||busy)return;setBusy('create');setNotice('');
  try{const r=await fetch('/api/circles',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name,description,tags,universeId:universeId||null})});const data=await r.json();if(!r.ok)throw Error(data.error);setCreating(false);setName('');setDescription('');setTags('');setUniverseId('');setSearch('');setScope('mine');setRevision(v=>v+1);setNotice('圈子已创建。你可以自行选择是否订阅。')}
  catch(e){setNotice(e instanceof Error?e.message:'网络连接失败，请重试。')}finally{setBusy('')}
 }
 return <main className="mx-auto w-full max-w-3xl overflow-y-auto p-5"><h1 className="text-2xl font-bold">圈子</h1><p className="my-3 text-sm text-muted-foreground">发现同好，按自己的兴趣订阅。订阅后可以发布帖子、评论和图片。</p>
 <div className="my-4 flex flex-wrap gap-2">{[['','全部圈子'],['subscribed','我订阅的'],['mine','我创建的']].map(([value,label])=><button key={value} disabled={Boolean(busy)} aria-pressed={scope===value} onClick={()=>setScope(value)} className="min-h-11 rounded-lg border border-border px-3">{label}</button>)}{token&&<button disabled={Boolean(busy)} className="min-h-11 rounded-lg bg-brand px-3 text-brand-foreground" onClick={()=>{setCreating(v=>!v);setNotice('')}}>{creating?'收起创建':'创建圈子'}</button>}</div>
 {notice&&<p role="status" className="my-3 break-words">{notice}</p>}
 {creating&&token&&<form onSubmit={create} className="my-4 space-y-3 rounded-xl border border-border p-4"><h2 className="text-lg font-semibold">创建圈子</h2><label className="block">圈子名称<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3"/></label><label className="block">圈子介绍<textarea required maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background p-3"/></label><label className="block">兴趣标签（逗号分隔）<input maxLength={200} value={tags} onChange={e=>setTags(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3"/></label><label className="block">关联世界观（可选）<select value={universeId} onChange={e=>setUniverseId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3"><option value="">不关联</option>{universes.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><p className="text-sm text-muted-foreground">创建不会自动订阅，也不会要求其他用户加入。</p><button disabled={Boolean(busy)} className="min-h-11 rounded-lg bg-brand px-4 text-brand-foreground">{busy==='create'?'正在创建…':'确认创建'}</button></form>}
 <label className="block">搜索圈子<input maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} className="my-2 min-h-11 w-full rounded-lg border border-border bg-background px-3" placeholder="名称、介绍或标签"/></label>
 {loading?<p role="status">正在加载圈子…</p>:scope&&!token?<p>登录后可查看个人圈子。<Link href="/login?next=/circles" className="ml-2 text-brand">登录</Link></p>:error?<div role="alert">{error}<button onClick={()=>setRevision(v=>v+1)} className="ml-2 min-h-11 text-brand">重试</button></div>:!rows.length?<p>暂无符合条件的圈子。</p>:<ul className="space-y-4">{rows.map(circle=><li key={circle.id} className="min-w-0 space-y-2 rounded-xl border border-border p-4"><h2 className="break-words text-xl font-semibold">{circle.name}{circle.isFeatured&&<span className="ml-2 rounded border px-2 text-xs text-brand">推荐</span>}</h2><p className="whitespace-pre-wrap break-words">{circle.description}</p>{circle.tags&&<p className="break-words text-sm text-brand">{circle.tags.split(',').map(t=>'#'+t).join(' ')}</p>}<p className="break-words text-sm text-muted-foreground">创建者：{(circle.owner?.displayName||circle.owner?.username||'站点')}{circle.universe&&' · 世界观：'+circle.universe.name}</p><p>{circle.subscriberCount} 人订阅</p><Link href={'/circles/'+circle.id} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-brand-foreground">进入圈子</Link>{token?<button aria-label={(circle.subscribed?'取消订阅':'订阅')+' '+circle.name} disabled={Boolean(busy)} onClick={()=>subscribe(circle)} className="ml-2 min-h-11 rounded-lg border border-border px-4">{busy===circle.id?'正在处理…':circle.subscribed?'取消订阅':'订阅'}</button>:<Link className="ml-2 inline-flex min-h-11 items-center text-brand" href="/login?next=/circles">登录后订阅</Link>}</li>)}</ul>}
 {pendingUnsubscribe&&<Dialog open onClose={()=>setPendingUnsubscribe(null)} title="取消订阅" description="取消后将不再收到圈子动态，但你已发布的内容不会被删除。" footer={<><button onClick={()=>setPendingUnsubscribe(null)} className="min-h-11 rounded-xl border border-border px-4 text-sm">保留订阅</button><button onClick={()=>{const circle=pendingUnsubscribe;setPendingUnsubscribe(null);void subscribe(circle,true)}} className="min-h-11 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground">确认取消</button></>}>确定取消订阅「{pendingUnsubscribe.name}」吗？</Dialog>}
 </main>
}
