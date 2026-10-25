'use client';
import {useEffect,useRef,useState} from 'react';
import {encodePcmWav} from './media/wav-encoder';
export function AudioRecorder({maxDurationSeconds,maxBytes,onComplete,onStart,disabled=false}:{maxDurationSeconds:number;maxBytes:number;onComplete:(file:File,durationMs:number)=>void;onStart?:()=>void;disabled?:boolean}){
 const [recording,setRecording]=useState(false),[starting,setStarting]=useState(false),[elapsed,setElapsed]=useState(0),[error,setError]=useState('');
 const state=useRef<{context:AudioContext;stream:MediaStream;source:MediaStreamAudioSourceNode;processor:ScriptProcessorNode;chunks:Float32Array[];samples:number;maxSamples:number;timer:ReturnType<typeof setInterval>}|null>(null);
 const pendingContext=useRef<AudioContext|null>(null);
 const alive=useRef(true),attempt=useRef(0),finish=useRef<()=>void>(()=>{});
 function stop(save:boolean){
  attempt.current++;const current=state.current;state.current=null;const pending=pendingContext.current;pendingContext.current=null;if(pending&&pending.state!=='closed')void pending.close();if(!current){if(alive.current)setStarting(false);return;}
  clearInterval(current.timer);current.processor.onaudioprocess=null;current.processor.disconnect();current.source.disconnect();current.stream.getTracks().forEach(track=>track.stop());void current.context.close();
  if(alive.current){setRecording(false);setStarting(false);if(save&&current.samples){const file=encodePcmWav(current.chunks,current.context.sampleRate);onComplete(file,Math.ceil(current.samples/current.context.sampleRate*1000));}else setElapsed(0);}
 }
 finish.current=()=>stop(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop(false);};},[]);
 async function start(){
  if(recording||starting||disabled)return;setError('');if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext){setError('此浏览器不支持录音，请使用支持麦克风的HTTPS浏览器。');return;}
  if(maxDurationSeconds<=0||maxBytes<=44){setError('录音限制尚未配置。');return;}
  const ticket=++attempt.current;setStarting(true);let stream:MediaStream|null=null,context:AudioContext|null=null;
  try{
   context=new AudioContext();pendingContext.current=context;await context.resume();stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!alive.current||ticket!==attempt.current){stream.getTracks().forEach(track=>track.stop());await context.close();return;}
   const source=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1);
   const maxSamples=Math.min(Math.floor(maxDurationSeconds*context.sampleRate),Math.floor((maxBytes-44)/2));
   const current={context,stream,source,processor,chunks:[] as Float32Array[],samples:0,maxSamples,timer:setInterval(()=>{if(alive.current&&state.current)setElapsed(state.current.samples/state.current.context.sampleRate);},250)};
   pendingContext.current=null;state.current=current;
   processor.onaudioprocess=event=>{if(state.current!==current)return;const remaining=current.maxSamples-current.samples;if(remaining<=0){finish.current();return;}const input=event.inputBuffer.getChannelData(0),chunk=new Float32Array(input.subarray(0,remaining));current.chunks.push(chunk);current.samples+=chunk.length;if(current.samples>=current.maxSamples)finish.current();};
   source.connect(processor);processor.connect(context.destination);setElapsed(0);setRecording(true);setStarting(false);onStart?.();
  }catch(e){pendingContext.current=null;stream?.getTracks().forEach(track=>track.stop());if(context&&context.state!=='closed')await context.close();if(alive.current&&ticket===attempt.current){setStarting(false);setError(e instanceof DOMException&&e.name==='NotAllowedError'?'未获得麦克风权限，请在浏览器设置允许后重试。':'录音无法开始，请检查麦克风后重试。');}}
 }
 return <section className="space-y-2"><p className="text-xs leading-5 text-muted-foreground">录音仅在此设备暂存；停止后可试听、取消、上传发送或选择转写。最长 {maxDurationSeconds} 秒，文件同时受上传大小限制。</p><div className="flex flex-wrap items-center gap-2">{recording?<><span role="status" className="text-sm tabular-nums">录音中 {Math.floor(elapsed)} 秒</span><button type="button" onClick={()=>stop(true)} className="min-h-11 rounded-full bg-primary px-4 text-sm text-primary-foreground">停止并试听</button><button type="button" onClick={()=>stop(false)} className="min-h-11 px-3 text-sm">取消录音</button></>:<button type="button" disabled={starting||disabled} onClick={()=>void start()} className="min-h-11 rounded-full border border-border px-4 text-sm">{starting?'等待麦克风权限…':'开始录音'}</button>}{starting&&<button type="button" onClick={()=>stop(false)} className="min-h-11 px-3 text-sm">取消</button>}</div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</section>;
}
