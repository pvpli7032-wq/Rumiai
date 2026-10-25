'use client';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';
import {Textarea} from '@rumiai/ui/textarea';
import type {JsonValue} from '@rumiai/contracts/settings/types';
type Option={key:string;label:string;instruction:string};
export function ResponseOptionsEditor({value,onChange,disabled,id}:{value:JsonValue;onChange:(value:JsonValue)=>void;disabled:boolean;id:string}){
 let parsed:unknown=value;try{if(typeof value==='string')parsed=JSON.parse(value);}catch{}
 if(!Array.isArray(parsed))return <Textarea id={id} value={typeof value==='string'?value:JSON.stringify(value)} disabled={disabled} onChange={e=>onChange(e.target.value)} aria-label="修正选项数据"/>;
 const rows=parsed as Option[];
 const update=(index:number,patch:Partial<Option>)=>onChange(rows.map((row,i)=>i===index?{...row,...patch}:row) as JsonValue);
 return <div id={id} className="space-y-4">{rows.length===0&&<p className="text-sm text-muted-foreground">尚无可选方式，前台使用角色默认。添加并保存后才会显示。</p>}{rows.map((row,index)=><fieldset key={index} disabled={disabled} className="space-y-3 border-b border-border pb-4"><legend className="mb-2 text-sm font-medium">选项 {index+1}</legend><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm block">前台名称<Input value={row.label??''} onChange={e=>update(index,{label:e.target.value})}/></label><label className="space-y-1 text-sm block">唯一标识<Input value={row.key??''} onChange={e=>update(index,{key:e.target.value})}/></label></div><label className="space-y-1 text-sm block">生成时执行的指令<Textarea rows={3} value={row.instruction??''} onChange={e=>update(index,{instruction:e.target.value})}/></label><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={disabled||index===0} onClick={()=>{const next=[...rows];[next[index-1],next[index]]=[next[index],next[index-1]];onChange(next as JsonValue);}}>上移</Button><Button size="sm" variant="ghost" disabled={disabled||index===rows.length-1} onClick={()=>{const next=[...rows];[next[index],next[index+1]]=[next[index+1],next[index]];onChange(next as JsonValue);}}>下移</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>{if(window.confirm('删除这个可选方式？保存后前台将不再提供。'))onChange(rows.filter((_,i)=>i!==index) as JsonValue);}}>删除选项</Button></div></fieldset>)}<Button variant="outline" disabled={disabled} onClick={()=>onChange([...rows,{key:'',label:'',instruction:''}] as JsonValue)}>添加选项</Button><p className="text-xs leading-5 text-muted-foreground">前台只显示名称；指令由服务端实际执行。移除选项后，原会话使用角色默认设置。</p></div>;
}
