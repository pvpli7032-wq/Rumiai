'use client';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@web/lib/auth-context';
export function AudioMessage({url,speechRate=1}:{url:string;speechRate?:number}){
 const {token}=useAuth();const ref=useRef<HTMLAudioElement>(null);const [source,setSource]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{setSource('');setError('');if(!token)return;const controller=new AbortController();let objectUrl='';void(async()=>{try{const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error();const blob=await response.blob();if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setSource(objectUrl);}catch{if(!controller.signal.aborted)setError('录音加载失败');}})();return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};},[url,token,attempt]);
 useEffect(()=>{if(ref.current)ref.current.playbackRate=speechRate;},[speechRate,source]);
 return error?<button type="button" onClick={()=>setAttempt(n=>n+1)} className="min-h-11 text-sm">{error}，重试</button>:source?<audio ref={ref} controls preload="metadata" src={source} aria-label="语音消息" className="my-1 h-11 w-full max-w-64"/>:<span role="status" className="text-sm text-muted-foreground">正在加载录音…</span>;
}
