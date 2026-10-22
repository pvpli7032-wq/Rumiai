'use client';

import {useEffect,useState} from 'react';
import {AdminPanel} from '../admin-page';
import {API} from '@/lib/api-paths';

type SceneFunnelReport={
  generatedAt:string;since:string;days:number;
  events:{opened:number;firstSent:number;activeEndConfirmed:number;continueClicked:number};
  rates:{firstMessageRate:number|null;activeEndRate:number|null;activeEndRateAfterFirstMessage:number|null;continueClickRate:number|null};
  definitions:{[key:string]:string};
};

import {formatNumber} from '@/lib/format/number';
const percent=(rate:number|null)=>rate===null?'样本不足':(rate*100).toFixed(2)+'%';

/**
 * V0 场景漏斗面板。与运营分析共用统计周期选择，数据只来自
 * scene_funnel_events 的事实计数，不展示用户或会话标识。
 */
export function SceneFunnelPanel({token,days}:{token:string;days:number}){
  const [report,setReport]=useState<SceneFunnelReport|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setReport(null);
    void fetch(API.admin.analyticsFunnel+'?days='+days,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data as SceneFunnelReport;})
      .then(setReport)
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'场景漏斗读取失败。');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[days,token]);

  return <AdminPanel title="V0 场景漏斗" description="按场景会话聚合的四节点漏斗；比率分母为 0 时显示样本不足，不当作 0%。">
    {loading&&<p className="text-sm text-muted-foreground">正在读取场景漏斗…</p>}
    {error&&<p className="text-sm text-red-600">{error}</p>}
    {report&&<div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['首条消息率',percent(report.rates.firstMessageRate)],
          ['主动结束率',percent(report.rates.activeEndRate)],
          ['主动结束率（首条消息口径）',percent(report.rates.activeEndRateAfterFirstMessage)],
          ['继续点击率',percent(report.rates.continueClickRate)],
        ].map(([label,value])=>(
          <div key={label} className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums leading-none text-foreground">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        事实计数（近 {report.days} 天）：开场到达 {formatNumber(report.events.opened)} · 首条消息 {formatNumber(report.events.firstSent)} · 结束确认 {formatNumber(report.events.activeEndConfirmed)} · 继续点击 {formatNumber(report.events.continueClicked)}
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">指标口径</summary>
        <div className="mt-1 space-y-1">
          {Object.entries(report.definitions).map(([key,text])=><p key={key}>{text}</p>)}
          <p>统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
        </div>
      </details>
    </div>}
  </AdminPanel>;
}
