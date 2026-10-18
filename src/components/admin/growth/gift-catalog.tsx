'use client';

import {useCallback,useEffect,useState} from 'react';

type GiftItem={id:string;code:string;name:string;description:string|null;emoji:string;coinPrice:number;isActive:boolean;sortOrder:number;version:number};
const blank=()=>({code:'',name:'',description:'',emoji:'🎁',coinPrice:10,isActive:true,sortOrder:0,reason:''});

export function GiftCatalogManagement({token,canManage}:{token:string;canManage:boolean}){
  const [items,setItems]=useState<GiftItem[]>([]),[draft,setDraft]=useState(blank),[editing,setEditing]=useState<GiftItem|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const refresh=useCallback(async()=>{const response=await fetch('/api/admin/growth/gifts',{headers:{Authorization:'Bearer '+token},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);setItems(data.gifts);},[token]);
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[refresh]);
  function startEdit(item:GiftItem){setEditing(item);setDraft({...item,description:item.description??'',reason:''});}
  async function save(){setSaving(true);setError('');try{const url=editing?`/api/admin/growth/gifts/${editing.id}`:'/api/admin/growth/gifts';const response=await fetch(url,{method:editing?'PATCH':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...draft,...(editing?{id:editing.id,version:editing.version}:{})})});const data=await response.json();if(!response.ok)throw Error(data.error);await refresh();setEditing(null);setDraft(blank());}catch(e){setError(e instanceof Error?e.message:'礼物保存失败。');}finally{setSaving(false);}}
  return <section className="space-y-4 rounded-xl border bg-card p-4">
    <header><h2 className="text-lg font-semibold">礼物目录</h2><p className="text-sm text-muted-foreground">赠礼价格由服务器目录决定；停用仅影响新赠送，历史礼物记录保留原价。</p></header>
    {items.length===0?<p className="text-sm text-muted-foreground">正在读取礼物…</p>:<div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">礼物</th><th className="p-2">代码</th><th className="p-2">金币</th><th className="p-2">状态</th>{canManage&&<th className="p-2">操作</th>}</tr></thead><tbody>{items.map(item=><tr key={item.id} className="border-b last:border-0"><td className="p-2">{item.emoji} {item.name}</td><td className="p-2">{item.code}</td><td className="p-2">{item.coinPrice}</td><td className="p-2">{item.isActive?'启用':'停用'}</td>{canManage&&<td className="p-2"><button className="min-h-9 rounded-md border px-3" onClick={()=>startEdit(item)}>编辑</button></td>}</tr>)}</tbody></table></div>}
    {canManage&&<div className="grid gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="space-y-1 text-sm">礼物代码<input disabled={!!editing||saving} value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3" placeholder="rose"/></label>
      <label className="space-y-1 text-sm">名称<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">图标<input value={draft.emoji} onChange={e=>setDraft({...draft,emoji:e.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">金币价格<input type="number" min={1} max={1000000} value={draft.coinPrice} onChange={e=>setDraft({...draft,coinPrice:Number(e.target.value)})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">排序<input type="number" min={0} value={draft.sortOrder} onChange={e=>setDraft({...draft,sortOrder:Number(e.target.value)})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      <label className="space-y-1 text-sm">说明<input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e=>setDraft({...draft,isActive:e.target.checked})}/>启用礼物</label>
      <label className="space-y-1 text-sm sm:col-span-2">操作理由<input required maxLength={500} value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      <div className="flex items-end gap-2"><button disabled={saving||!draft.reason.trim()} onClick={()=>void save()} className="min-h-10 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50">{saving?'保存中…':editing?'保存礼物':'新增礼物'}</button>{editing&&<button onClick={()=>{setEditing(null);setDraft(blank());}} className="min-h-10 rounded-lg border px-4">取消</button>}</div>
    </div>}
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>;
}
