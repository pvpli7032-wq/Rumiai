'use client';
import {useEffect,useState} from 'react';
export function SelectedImagePreview({file,onRemove}:{file:File;onRemove:()=>void}){
 const [url,setUrl]=useState('');
 useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
 return <span className="relative inline-flex w-24 shrink-0 flex-col gap-1">{url&&<img src={url} alt={file.name} className="h-20 w-24 rounded-xl object-cover"/>}<span className="truncate text-xs text-muted-foreground" title={file.name}>{file.name}</span><button type="button" aria-label={'移除 '+file.name} onClick={onRemove} className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-card text-sm">×</button></span>;
}
