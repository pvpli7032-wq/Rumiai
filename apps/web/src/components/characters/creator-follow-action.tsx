'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@web/lib/auth-context';
import {loginWithNext} from '@web/lib/next-path';
export function CreatorFollowAction({username,creatorId}:{username:string;creatorId:string}){
 const {token,user}=useAuth(),router=useRouter(),[following,setFollowing]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),lock=useRef(false);
 useEffect(()=>{const controller=new AbortController();setReady(false);setError('');fetch('/api/creators/'+encodeURIComponent(username),{headers:token?{Authorization:'Bearer '+token}:{},signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'关注状态读取失败。');return data;}).then(data=>{if(!controller.signal.aborted){setFollowing(Boolean(data.creator?.isFollowing));setReady(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[username,token,revision]);
 async function toggle(){if(!token){router.push(loginWithNext());return;}if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await fetch('/api/creators/'+encodeURIComponent(username)+'/follow',{method:following?'DELETE':'POST',headers:{Authorization:'Bearer '+token}});const data=await r.json();if(!r.ok)throw Error(data.error||'关注操作失败。');setFollowing(value=>!value);window.dispatchEvent(new Event('xingban:creator-follow-changed'));}catch(e){setError(e instanceof Error?e.message:'关注操作失败。');}finally{lock.current=false;setBusy(false);}}
 if(user?.id===creatorId)return null;
 return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" disabled={busy||!ready} onClick={()=>void toggle()} className="min-h-11 px-3 text-xs text-primary">{busy?'处理中…':following?'已关注 · 取消':'关注创作者'}</button>{error&&<span role="alert" className="text-xs text-destructive">{error}<button type="button" onClick={()=>setRevision(v=>v+1)} className="ml-1 min-h-11 underline">重试</button></span>}</span>;
}
