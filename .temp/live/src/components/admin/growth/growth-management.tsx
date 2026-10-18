'use client';

import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '@/lib/auth-context';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {CheckinRewards} from './checkin-rewards';
import {MissionManagement,type Mission} from './missions';
import {GiftCatalogManagement} from './gift-catalog';
import {RewardBudget} from './reward-budget';

export function GrowthManagement(){
  const {token,isLoading}=useAuth(),{permissions,loading:accessLoading,error:accessError}=useAdminAccess();
  const [missions,setMissions]=useState<Mission[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const canRead=permissions.includes('growth.read'),canManage=permissions.includes('growth.manage');
  const refresh=useCallback(async(showLoading=true)=>{
    if(!token||!canRead){setLoading(false);return;}
    if(showLoading)setLoading(true);setError('');
    try{const response=await fetch('/api/admin/growth/missions',{headers:{Authorization:'Bearer '+token},cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);setMissions(data.missions);}
    catch(e){setError(e instanceof Error?e.message:'任务配置读取失败。');}
    finally{if(showLoading)setLoading(false);}
  },[token,canRead]);
  useEffect(()=>{void refresh();},[refresh]);
  if(isLoading||accessLoading)return <main className="p-4"><p role="status">正在验证任务管理权限…</p></main>;
  if(accessError)return <main className="p-4"><p role="alert">{accessError}</p></main>;
  if(!token||!canRead)return <main className="p-4"><p role="alert">当前账号没有任务与奖励查看权限。</p></main>;
  return <main className="mx-auto w-full max-w-[1440px] space-y-5">
    <header><h1 className="text-2xl font-bold md:text-3xl">任务与奖励</h1><p className="mt-2 text-sm text-muted-foreground">任务领取由服务器核验活动记录；金币发放写入统一金币流水。签到默认档位沿用现行奖励值。</p></header>
    <RewardBudget token={token}/>
    {error&&<p role="alert" className="rounded-lg border border-red-500/30 p-4 text-red-400">{error}</p>}
    {loading?<p role="status">正在读取任务…</p>:<MissionManagement token={token} canManage={canManage} missions={missions} onSaved={()=>void refresh(false)}/>}
    <CheckinRewards token={token} canManage={canManage} onSaved={()=>void refresh(false)}/>
    <GiftCatalogManagement token={token} canManage={canManage}/>
  </main>;
}
