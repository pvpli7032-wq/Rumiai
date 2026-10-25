'use client';
import {useEffect, useState} from 'react';
import {api} from '@web/lib/api-client';
type Entry = {id: string; content: string; keywords: string[]; priority: number; enabled: boolean};
type Book = {id: string; name: string; enabled: boolean; isPublic: boolean; version: number; entries?: Entry[]};
export function WorldbookManager({token, characterId, canBindCharacter, onChanged}: {token: string; characterId: string; canBindCharacter: boolean; onChanged: () => void}) {
  const [books, setBooks] = useState<Book[]>([]), [book, setBook] = useState<Book | null>(null), [newName, setNewName] = useState('');
  const [entry, setEntry] = useState<Entry | 'new' | null>(null), [keywords, setKeywords] = useState(''), [content, setContent] = useState(''), [priority, setPriority] = useState(0), [entryEnabled, setEntryEnabled] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [entryMaxChars, setEntryMaxChars] = useState<number | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function load() {const data = await api.get<{items: Book[]; entryMaxChars: number}>('/api/me/worldbooks', {token}); setBooks(data.items); setEntryMaxChars(data.entryMaxChars);}
  useEffect(() => {void load().catch(cause => setError(cause instanceof Error ? cause.message : '世界书读取失败。'));}, [token]);
  async function open(id: string) {setError(''); setNotice(''); setEntry(null); setConfirmDelete(false); try {setBook(await api.get<Book>('/api/me/worldbooks/' + id, {token}));} catch (cause) {setError(cause instanceof Error ? cause.message : '读取失败。');}}
  async function action(work: () => Promise<void>) {if (busy) return; setBusy(true); setError(''); setNotice(''); try {await work(); onChanged();} catch (cause) {setError(cause instanceof Error ? cause.message : '操作失败，请重试。');} finally {setBusy(false);}}
  function editEntry(value: Entry | 'new') {setEntry(value); setKeywords(value === 'new' ? '' : value.keywords.join('\n')); setContent(value === 'new' ? '' : value.content); setPriority(value === 'new' ? 0 : value.priority); setEntryEnabled(value === 'new' ? true : value.enabled); setError('');}
  const input = 'web-control min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', button = 'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border px-4 text-sm disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring';
  return <section className="space-y-5 text-sm">
    <p className="leading-6 text-muted-foreground">世界书按触发词补充背景。只有开启且命中的条目才按优先级和预算进入AI上下文，不会把设定当作已经发生的事实。</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status" className="text-brand">{notice}</p>}
    {!book ? <>
      <div className="divide-y divide-border">{books.map(item => <button key={item.id} type="button" className="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-left" onClick={() => void open(item.id)}><span><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs text-muted-foreground">{item.enabled ? '已开启' : '已停用'} · {item.isPublic ? '公开设定' : '私有'}</span></span><span aria-hidden>›</span></button>)}</div>
      {!books.length && <p className="text-muted-foreground">还没有世界书，先创建一本，再添加触发词和设定。</p>}
      <form className="space-y-3" onSubmit={event => {event.preventDefault(); void action(async () => {const created = await api.post<Book>('/api/me/worldbooks', {name: newName, enabled: true, isPublic: false}, {token}); setNewName(''); await load(); await open(created.id);});}}><label className="block space-y-2"><span className="text-sm">世界书名称</span><input aria-label="新世界书名称" className={input} value={newName} onChange={event => setNewName(event.target.value)} /></label><button type="submit" disabled={busy || !newName.trim()} className={button + ' w-full'}>{busy ? '正在创建…' : '创建世界书'}</button></form>
    </> : entry ? <form className="space-y-4" onSubmit={event => {event.preventDefault(); void action(async () => {
      const body = {keywords: keywords.split(/[\n,，]/).map(word => word.trim()).filter(Boolean), content, priority, enabled: entryEnabled};
      if (entry === 'new') await api.post('/api/me/worldbooks/' + book.id + '/entries', body, {token});
      else await api.put('/api/me/worldbooks/' + book.id + '/entries/' + entry.id, body, {token});
      await open(book.id);
    });}}>
      <h3 className="font-medium">{entry === 'new' ? '添加条目' : '编辑条目'}</h3>
      <label className="block space-y-2"><span>触发词（每行一个）</span><textarea rows={3} className={input} value={keywords} onChange={event => setKeywords(event.target.value)} /></label>
      <label className="block space-y-2"><span>背景内容</span><textarea rows={5} maxLength={entryMaxChars} className={input} value={content} onChange={event => setContent(event.target.value)} /></label>
      <label className="block space-y-2"><span>优先级（较高者先参考）</span><input type="number" className={input} value={priority} onChange={event => setPriority(Number(event.target.value))} /></label>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={entryEnabled} onChange={event => setEntryEnabled(event.target.checked)} />启用此条目</label>
      <div className="grid grid-cols-2 gap-3"><button type="button" className={button + ' flex-1'} disabled={busy} onClick={() => setEntry(null)}>返回条目</button><button type="submit" className={button + ' flex-1 bg-brand text-brand-foreground'} disabled={busy || !content.trim() || !keywords.trim()}>{busy ? '保存中…' : '保存条目'}</button></div>
    </form> : <>
      <button type="button" className="min-h-11 text-muted-foreground" onClick={() => {setBook(null); void load();}}>‹ 返回世界书列表</button>
      <label className="block space-y-2"><span>世界书名称</span><input className={input} value={book.name} onChange={event => setBook({...book, name: event.target.value})} /></label>
      <div className="space-y-2"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={book.enabled} onChange={event => setBook({...book, enabled: event.target.checked})} />开启世界书</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={book.isPublic} onChange={event => setBook({...book, isPublic: event.target.checked})} />允许作为公开角色设定使用</label></div>
      <button type="button" disabled={busy} className={button + ' w-full'} onClick={() => void action(async () => {await api.put('/api/me/worldbooks/' + book.id, {name: book.name, enabled: book.enabled, isPublic: book.isPublic, version: book.version}, {token}); await open(book.id); await load(); setNotice('世界书设置已保存。');})}>保存世界书设置</button>
      {canBindCharacter && <details><summary className="min-h-11 cursor-pointer py-3">作为当前角色的默认背景</summary><p className="mb-2 text-xs leading-5 text-muted-foreground">公开角色只能绑定公开世界书。绑定后，符合权限的会话会按触发词参考。</p><div className="grid grid-cols-2 gap-3">{[true, false].map(bind => <button type="button" key={String(bind)} className={button} disabled={busy} onClick={() => void action(async () => {await api.put('/api/characters/' + characterId + '/worldbooks', {worldbookId: book.id, bind}, {token}); setNotice(bind ? '已绑定当前角色。' : '已解除角色绑定。');})}>{bind ? '绑定当前角色' : '解除绑定'}</button>)}</div></details>}
      <div className="divide-y divide-border">{book.entries?.map(item => <div key={item.id} className="flex items-start gap-3 py-4"><button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => editEntry(item)}><span className="block font-medium">{item.keywords.join('、')}</span><span className="mt-1 block line-clamp-2 leading-6 text-muted-foreground">{item.content}</span><span className="mt-1 block text-xs text-muted-foreground">优先级 {item.priority} · {item.enabled ? '启用' : '停用'}</span></button><button type="button" className="min-h-11 px-2 text-muted-foreground" disabled={busy} onClick={() => void action(async () => {await api.del('/api/me/worldbooks/' + book.id + '/entries/' + item.id, {token}); await open(book.id);})}>删除条目</button></div>)}</div>
      <button type="button" className={button + ' w-full'} onClick={() => editEntry('new')}>添加条目</button>
      {confirmDelete ? <div className="space-y-2 rounded-xl bg-secondary p-3"><p>删除后会解除所有会话和角色绑定，不能恢复。</p><div className="flex gap-4"><button type="button" className="min-h-11 text-destructive" disabled={busy} onClick={() => void action(async () => {await api.del('/api/me/worldbooks/' + book.id, {token}); setBook(null); await load();})}>确认删除世界书</button><button type="button" className="min-h-11" onClick={() => setConfirmDelete(false)}>取消</button></div></div> : <button type="button" className="min-h-11 w-full text-destructive" onClick={() => setConfirmDelete(true)}>删除世界书</button>}
    </>}
  </section>;
}
