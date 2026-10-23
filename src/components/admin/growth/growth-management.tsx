'use client';

import {useCallback,useEffect,useState} from 'react';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import {AdminNotice, AdminPage, AdminPageHeader} from '@/components/admin/admin-page';
import {CheckinRewards} from './checkin-rewards';
import {MissionManagement,type Mission} from './missions';
import {GiftCatalogManagement} from './gift-catalog';
import {RewardBudget} from './reward-budget';
import {API} from '@/lib/api-paths';

export function GrowthManagement(){
  const {sessionActive,permissions,loading:accessLoading,error:accessError}=useAdminAccess();
  const [missions,setMissions]=useState<Mission[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const canRead=permissions.includes('growth.read'),canManage=permissions.includes('growth.manage');
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
    <RewardBudget sessionActive={sessionActive}/>
    {error&&<AdminNotice tone="error" title={error} className="py-6" />}
    {loading
      ? <AdminNotice tone="loading" title="正在读取任务…" />
      : <MissionManagement sessionActive={sessionActive} canManage={canManage} missions={missions} onSaved={()=>void refresh(false)}/>}
    <CheckinRewards sessionActive={sessionActive} canManage={canManage} onSaved={()=>void refresh(false)}/>
    <GiftCatalogManagement sessionActive={sessionActive} canManage={canManage}/>
  </AdminPage>;
}
