'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';

export function MaintenanceNotice(){
  const pathname=usePathname();const [message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let reading=false;
    async function refresh(){
      if(reading)return;reading=true;
      try{const response=await fetch('/api/operations/status',{cache:'no-store',signal:controller.signal});if(!response.ok)return;const policy=await response.json();if(!controller.signal.aborted&&typeof policy.enabled==='boolean'&&typeof policy.message==='string')setMessage(policy.enabled?policy.message:'');}
      catch{}finally{reading=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),30000);window.addEventListener('focus',refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[pathname]);
  if(!message)return null;
  return <p role="status" aria-label="维护通知" className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-300"><strong>系统维护 · 业务只读</strong><span className="ml-2 break-words">{message}</span></p>;
}
