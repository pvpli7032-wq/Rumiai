'use client';

import { useCallback, useEffect, useState } from 'react';
import { zhError } from '@rumiai/contracts/copy/zh';

export interface CommentAuthor {
  id: string;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface CommentNode {
  id: string;
  body: string;
  likeCount: number;
  createdAt: string;
  author: CommentAuthor;
  isMine: boolean;
  hasLiked: boolean;
  replies?: CommentNode[];
  replyCount?: number;
}

/** Applies `fn` to one node anywhere in the two-level tree. */
function mapTree(
  list: CommentNode[],
  id: string,
  fn: (node: CommentNode) => CommentNode
): CommentNode[] {
  return list.map((c) => {
    if (c.id === id) return fn(c);
    if (c.replies?.some((r) => r.id === id)) {
      return { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) };
    }
    return c;
  });
}

/**
 * 角色评论的数据层：取列表、发评论、点赞、改、删，并把结果写回两层的评论树。
 * 渲染在 character-comments.tsx / comment-row.tsx，这里不含任何 JSX。
 */
export function useCharacterComments(characterId: string, token: string | null, requireLogin: () => boolean) {
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sort,setSort]=useState<'new'|'popular'>('new');
  const [replyCursors,setReplyCursors]=useState<Record<string,string|null>>({});

  const headers = useCallback(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const load = useCallback(
    async (cursor?: string) => {
      // The token is sent so each comment comes back with whether *this* reader liked it.
      const params=new URLSearchParams({sort});if(cursor)params.set('cursor',cursor);
      const url='/api/characters/'+encodeURIComponent(characterId)+'/comments?'+params;
      setError('');
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) { setError("评论加载失败"); return; }
      const data = await res.json();
      setComments((prev) => (cursor ? [...prev, ...data.comments] : data.comments));
      setNextCursor(data.nextCursor);
    },
    [characterId, headers,sort],
  );

  useEffect(() => {
    setLoading(true);
    setComments([]);setReplyCursors({});
    load().catch(()=>setError('网络连接失败，请重试。')).finally(() => setLoading(false));
  }, [load]);

  async function mutate(path:string,method:string,body?:unknown){
    const res=await fetch(path,{method,headers:{...headers(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(zhError(data.error||'')||'评论操作失败，请重试。');return data;
  }
  async function post(body:string,parentId?:string):Promise<boolean>{
    if(requireLogin()||!body.trim()||busy)return false;setBusy(true);setError('');
    try{await mutate('/api/characters/'+encodeURIComponent(characterId)+'/comments','POST',{body:body.trim(),parent_id:parentId});await load();return true;}
    catch(e){setError(e instanceof Error?e.message:'评论发送失败，草稿已保留。');return false;}finally{setBusy(false);}
  }
  async function toggleLike(node:CommentNode){
    if(requireLogin()||busy)return;setBusy(true);setError('');
    try{const data=await mutate('/api/comments/'+encodeURIComponent(node.id)+'/like',node.hasLiked?'DELETE':'POST');setComments(rows=>mapTree(rows,node.id,current=>({...current,hasLiked:!node.hasLiked,likeCount:data.likeCount})));}
    catch(e){setError(e instanceof Error?e.message:'点赞失败，请重试。');}finally{setBusy(false);}
  }
  async function saveEdit(id:string,body:string):Promise<boolean>{
    if(!body.trim()||busy)return false;setBusy(true);setError('');
    try{const data=await mutate('/api/comments/'+encodeURIComponent(id),'PATCH',{body:body.trim()});setComments(rows=>mapTree(rows,id,current=>({...current,body:data.comment.body})));return true;}
    catch(e){setError(e instanceof Error?e.message:'修改失败，内容已保留。');return false;}finally{setBusy(false);}
  }
  async function remove(id:string){
    if(busy)return;setBusy(true);setError('');
    try{await mutate('/api/comments/'+encodeURIComponent(id),'DELETE');await load();}catch(e){setError(e instanceof Error?e.message:'删除失败，请重试。');}finally{setBusy(false);}
  }
  async function loadReplies(parentId:string) {
    setBusy(true);setError('');
    try {const cursor=replyCursors[parentId];const res=await fetch('/api/comments/'+encodeURIComponent(parentId)+'/replies'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:headers()});const data=await res.json();if(!res.ok)throw Error(data.error||'回复加载失败。');setComments(rows=>rows.map(row=>row.id===parentId?{...row,replies:[...new Map([...(row.replies??[]),...data.comments].map(item=>[item.id,item])).values()]}:row));setReplyCursors(values=>({...values,[parentId]:data.nextCursor}));}
    catch(e){setError(e instanceof Error?e.message:'回复加载失败。');}finally{setBusy(false);}
  }
  return { sort,setSort,loadReplies,replyCursors,comments, nextCursor, loading, busy, error, load, post, toggleLike, saveEdit, remove };
}
