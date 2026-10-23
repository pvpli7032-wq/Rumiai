'use client';

import {useCallback,useEffect,useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {useAdminAccess} from '@admin/components/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader} from '@admin/components/admin-page';
import {CheckinRewards} from './checkin-rewards';
import {MissionManagement,type Mission} from './missions';
import {GiftCatalogManagement} from './gift-catalog';
import {RewardBudget} from './reward-budget';
import {API} from '@rumiai/contracts/api-paths';

const SECTIONS = [['missions','任务配置'],['checkin','签到奖励'],['gifts','礼物目录']] as const;
type GrowthSection = (typeof SECTIONS)[number][0];

export function GrowthManagement(){
  const router=useRouter(),searchParams=useSearchParams();
  const requestedSection=searchParams.get('tab');
  const section:GrowthSection=SECTIONS.some(([id])=>id===requestedSection)?requestedSection as GrowthSection:'missions';
  const {sessionActive,permissions,loading:accessLoading,error:accessError}=useAdminAccess();
  const [missions,setMissions]=useState<Mission[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const canRead=permissions.includes('growth.read'),canManage=permissions.includes('growth.manage');
  const selectSection=useCallback((value:string,replace=false)=>{const next=SECTIONS.some(([id])=>id===value)?value as GrowthSection:'missions';const params=new URLSearchParams(searchParams.toString());if(next==='missions')params.delete('tab');else params.set('tab',next);const href=params.size?`/admin/growth?${params}`:'/admin/growth';if(replace)router.replace(href,{scroll:false});else router.push(href,{scroll:false});},[router,searchParams]);
  useEffect(()=>{if(requestedSection&&!SECTIONS.some(([id])=>id===requestedSection))selectSection('missions',true);},[requestedSection,selectSection]);
  const refresh=useCallback(async(showLoading=true)=>{
    if(!sessionActive||!canRead){setLoading(false);return;}
    if(showLoading)setLoading(true);setError('');
    try{const response=await fetch(API.admin.growth.missions,{credentials: 'include',cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);setMissions(data.missions);}
    catch(e){setError(e instanceof Error?e.message:'任务配置读取失败。');}
    finally{if(showLoading)setLoading(false);}
  },[sessionActive,canRead]);
  useEffect(()=>{void refresh();},[refresh]);
  if(loading||accessLoading)return <AdminPage><AdminNotice tone="loading" title="正在验证任务管理权限…" /></AdminPage>;
  if(accessError)return <AdminPage><AdminNotice tone="error" title={accessError} /></AdminPage>;
  if(!sessionActive||!canRead)return <AdminPage><AdminNotice tone="denied" title="当前账号没有任务与奖励查看权限。" /></AdminPage>;
  return <AdminPage>
    <AdminPageHeader eyebrow="增长与运营" title="任务与奖励" description="任务领取由服务器核验活动记录；金币发放写入统一金币流水。签到默认档位沿用现行奖励值。" />
    <div className="rounded-xl border border-border bg-card p-1.5 shadow-sm" role="tablist" aria-label="增长配置分区">
      {SECTIONS.map(([id,label]) => (
        <button key={id} type="button" role="tab" aria-selected={section===id} onClick={() => selectSection(id)} className={`min-h-10 rounded-lg px-4 text-sm font-medium transition-colors ${section===id ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>
      ))}
    </div>
    <RewardBudget sessionActive={sessionActive}/>
    {error&&<AdminNotice tone="error" title={error} className="py-6" />}
    <div hidden={section !== 'missions'}>{loading ? <AdminNotice tone="loading" title="正在读取任务…" /> : <MissionManagement sessionActive={sessionActive} canManage={canManage} missions={missions} onSaved={()=>void refresh(false)}/>}</div>
    <div hidden={section !== 'checkin'}><CheckinRewards sessionActive={sessionActive} canManage={canManage} onSaved={()=>void refresh(false)}/></div>
    <div hidden={section !== 'gifts'}><GiftCatalogManagement sessionActive={sessionActive} canManage={canManage}/></div>
  </AdminPage>;
}
