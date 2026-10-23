'use client';
import {useEffect,useState} from 'react';
let cache:Record<string,unknown>|null=null;
export function useUiConfig(){const [values,setValues]=useState<Record<string,unknown>>(cache??{});useEffect(()=>{let alive=true;fetch('/api/ui-config',{credentials:'same-origin'}).then(r=>r.ok?r.json():{}).then(next=>{cache=next;if(alive)setValues(next);}).catch(()=>{});return()=>{alive=false;};},[]);return values;}
export function readNumber(values:Record<string,unknown>,key:string){const value=values[key];return typeof value==='number'&&Number.isFinite(value)?value:undefined;}
