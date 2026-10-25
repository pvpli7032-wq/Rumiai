'use client';
import {useEffect, useState} from 'react';
import {api} from '@web/lib/api-client';

type Persona = {id: string; name: string; description: string; version: number};
export function PersonaManager({token, onChanged}: {token: string; onChanged: () => void}) {
  const [items, setItems] = useState<Persona[]>([]), [editing, setEditing] = useState<Persona | 'new' | null>(null);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [maxChars, setMaxChars] = useState<number | undefined>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [removeId, setRemoveId] = useState<string | null>(null);
  async function load() {const result = await api.get<{items: Persona[]; maxChars: number}>('/api/me/personas', {token}); setItems(result.items); setMaxChars(result.maxChars);}
  useEffect(() => {void load().catch(cause => setError(cause instanceof Error ? cause.message : '身份读取失败。'));}, [token]);
  function edit(persona: Persona | 'new') {setEditing(persona); setName(persona === 'new' ? '' : persona.name); setDescription(persona === 'new' ? '' : persona.description); setError('');}
  async function save() {
    if (!editing || busy) return;
    setBusy(true); setError('');
    try {
      const body = {name, description, ...(editing === 'new' ? {} : {version: editing.version})};
      if (editing === 'new') await api.post('/api/me/personas', body, {token});
      else await api.put('/api/me/personas/' + editing.id, body, {token});
      await load(); setEditing(null); onChanged();
    } catch (cause) {setError(cause instanceof Error ? cause.message : '身份保存失败。');}
    finally {setBusy(false);}
  }
  async function remove(id: string) {
    setBusy(true); setError('');
    try {await api.del('/api/me/personas/' + id, {token}); await load(); setRemoveId(null); onChanged();}
    catch (cause) {setError(cause instanceof Error ? cause.message : '删除失败。');}
    finally {setBusy(false);}
  }
  const control = 'web-control min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return <section className="space-y-5">
    <p className="text-sm leading-6 text-muted-foreground">身份描述的是本次对话中的“我”。只在你明确绑定的会话中生效，不修改账号公开资料。</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {editing ? <form className="space-y-4" onSubmit={event => {event.preventDefault(); void save();}}>
      <label className="block space-y-2 text-sm"><span>身份名称</span><input value={name} onChange={event => setName(event.target.value)} className={control} /></label>
      <label className="block space-y-2 text-sm"><span>身份描述</span><textarea rows={5} maxLength={maxChars} value={description} onChange={event => setDescription(event.target.value)} className={control} /></label>
      <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => setEditing(null)} className="min-h-12 flex-1 rounded-full border border-border text-sm">返回列表</button><button type="submit" disabled={busy || !name.trim() || !description.trim()} className="min-h-12 flex-1 rounded-full bg-brand text-sm text-brand-foreground disabled:opacity-40">{busy ? '保存中…' : '保存身份'}</button></div>
    </form> : <>
      <div className="divide-y divide-border">{items.map(item => <div key={item.id} className="py-4">
        <div className="flex items-start gap-3"><button type="button" className="min-h-11 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring" onClick={() => edit(item)}><span className="block text-[15px] font-medium">{item.name}</span><span className="mt-1 block line-clamp-2 text-sm leading-6 text-muted-foreground">{item.description}</span></button><button type="button" disabled={busy} className="min-h-11 px-2 text-sm text-muted-foreground" onClick={() => setRemoveId(item.id)}>删除</button></div>
        {removeId === item.id && <div className="mt-3 space-y-2 rounded-xl bg-secondary p-3 text-sm"><p>删除身份后，关联会话恢复未绑定状态。聊天历史仍保留。</p><div className="flex gap-4"><button type="button" disabled={busy} className="min-h-11 text-destructive" onClick={() => void remove(item.id)}>确认删除</button><button type="button" disabled={busy} className="min-h-11" onClick={() => setRemoveId(null)}>取消</button></div></div>}
      </div>)}</div>
      {!items.length && <p className="text-sm text-muted-foreground">还没有身份。可以从一个简短自我介绍开始。</p>}
      <button type="button" className="min-h-12 w-full rounded-full border border-border text-sm" onClick={() => edit('new')}>添加身份</button>
    </>}
  </section>;
}
