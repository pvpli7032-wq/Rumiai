'use client';
import {useCallback,useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {backFallback} from '@web/lib/navigation';

type Entry={key:string;href:string;previous?:{key:string;href:string}};
const FIELD='xingbanNavigation';
function hrefOf(value:string|URL):string|null {
  const url=new URL(value,window.location.href);
  if(url.origin!==window.location.origin)return null;
  return url.pathname+url.search+url.hash;
}
function entryOf(value:unknown):Entry|undefined {
  if(!value||typeof value!=='object')return;
  const entry=(value as Record<string,unknown>)[FIELD] as Entry|undefined;
  if(!entry||typeof entry.key!=='string'||typeof entry.href!=='string'||hrefOf(entry.href)!==entry.href)return;
  return entry;
}
function currentHref(){return location.pathname+location.search+location.hash;}

/** Provenance on browser entries only; Next remains the router and owns its state. */
export function NavigationHistoryBoundary(){
  useEffect(()=>{
    const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
    const make=(href:string,previous?:Entry):Entry=>({key:crypto.randomUUID(),href,...(previous?{previous:{key:previous.key,href:previous.href}}:{})});
    const initial=entryOf(history.state);
    replace({...history.state,[FIELD]:initial?.href===currentHref()?initial:make(currentHref())},'');
    const pushState:History['pushState']=(data,unused,url)=>{
      const href=hrefOf(url??location.href);
      if(!href)return push(data,unused,url);
      const current=entryOf(history.state);
      const next=current?.href===href?current:make(href,current);
      const state={...data,[FIELD]:next};
      return current?.href===href?replace(state,unused,url):push(state,unused,url);
    };
    const replaceState:History['replaceState']=(data,unused,url)=>{
      const href=hrefOf(url??location.href);
      if(!href)return replace(data,unused,url);
      const current=entryOf(history.state)??make(currentHref());
      return replace({...data,[FIELD]:{...current,href}},unused,url);
    };
    history.pushState=pushState;history.replaceState=replaceState;
    return()=>{if(history.pushState===pushState)history.pushState=push;if(history.replaceState===replaceState)history.replaceState=replace;};
  },[]);
  return null;
}

export function useAppBack(fallback?:string){
  const router=useRouter();
  return useCallback(()=>{
    const current=entryOf(history.state);
    const previous=current?.previous;
    const auth=/^\/(?:login|register|forgot-password|reset-password|activate-account|verify-email|onboarding)(?:[/?]|$)|^\/[^/]+\/auth(?:[/?]|$)/;
    if(current?.href===currentHref()&&previous?.key&&typeof previous.href==='string'&&hrefOf(previous.href)===previous.href&&previous.href!==current.href&&!auth.test(previous.href))router.back();
    else router.replace(hrefOf(fallback??backFallback(currentHref()))??'/discover');
  },[router,fallback]);
}
