'use client';

import type {SitePageBlock} from '@/lib/use-site-content';

type DraftBlock=Record<string,unknown>;
type BlockKind=SitePageBlock['type'];
const kinds:Array<{value:BlockKind;label:string}>=[
  {value:'PARAGRAPH',label:'正文段落'},
  {value:'HEADING',label:'标题'},
  {value:'LINK',label:'站内文本链接'},
  {value:'IMAGE',label:'站点图片'},
  {value:'LIST',label:'项目列表'},
  {value:'BUTTON',label:'行动按钮'},
  {value:'NOTICE',label:'提示框'},
  {value:'CARD_GRID',label:'卡片网格'},
];
const emptyCard=()=>({title:'',description:'',href:'/discover',actionLabel:'了解更多'});
function emptyBlock(kind:string):DraftBlock{
  if(kind==='HEADING')return {type:kind,text:'',level:2};
  if(kind==='LINK')return {type:kind,text:'',href:'/discover'};
  if(kind==='IMAGE')return {type:kind,src:'/brand/icon.svg',alt:'站点图片',caption:''};
  if(kind==='LIST')return {type:kind,ordered:false,items:['']};
  if(kind==='BUTTON')return {type:kind,text:'了解更多',href:'/discover',variant:'PRIMARY'};
  if(kind==='NOTICE')return {type:kind,text:'',tone:'INFO'};
  if(kind==='CARD_GRID')return {type:kind,heading:'功能介绍',cards:[emptyCard()]};
  return {type:'PARAGRAPH',text:''};
}

export function PageBlockEditor({value,onChange}:{value:SitePageBlock[];onChange:(blocks:SitePageBlock[])=>void}){
  const blocks=(Array.isArray(value)?value:[]) as DraftBlock[];
  const commit=(next:DraftBlock[])=>onChange(next as unknown as SitePageBlock[]);
  const update=(index:number,patch:DraftBlock)=>commit(blocks.map((block,i)=>i===index?{...block,...patch}:block));
  return <div className="mt-2 space-y-3">
    {blocks.map((block,index)=><section key={index} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">组件 {index+1}</span><select aria-label={`页面组件类型 ${index+1}`} value={String(block.type)} onChange={event=>commit(blocks.map((item,i)=>i===index?emptyBlock(event.target.value):item))} className="min-h-10 min-w-0 flex-1 rounded-lg border bg-background px-2">{kinds.map(kind=><option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><button type="button" onClick={()=>commit(blocks.filter((_,i)=>i!==index))} className="min-h-10 rounded-lg border px-3 text-red-400">移除组件</button></div>
      {block.type==='CARD_GRID'?<>
        <label className="block text-sm">卡片区标题<input aria-label={`卡片区标题 ${index+1}`} value={String(block.heading??'')} maxLength={80} onChange={event=>update(index,{heading:event.target.value})} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3"/></label>
        {((Array.isArray(block.cards)?block.cards:[]) as DraftBlock[]).map((card,cardIndex)=>{
          const cards=(Array.isArray(block.cards)?block.cards:[]) as DraftBlock[];
          const updateCard=(patch:DraftBlock)=>update(index,{cards:cards.map((item,i)=>i===cardIndex?{...item,...patch}:item)});
          return <article key={cardIndex} className="grid min-w-0 gap-2 rounded-lg bg-muted/30 p-3 md:grid-cols-2"><div className="flex items-center justify-between gap-2 md:col-span-2"><h4 className="text-sm font-medium">卡片 {cardIndex+1}</h4><button type="button" disabled={cards.length<=1} onClick={()=>update(index,{cards:cards.filter((_,i)=>i!==cardIndex)})} className="min-h-9 rounded border px-2 text-xs disabled:opacity-50">移除卡片</button></div><label className="grid gap-1 text-sm">卡片标题<input aria-label={`卡片标题 ${index+1}-${cardIndex+1}`} value={String(card.title??'')} maxLength={80} onChange={event=>updateCard({title:event.target.value})} className="min-h-10 min-w-0 rounded-lg border bg-background px-3"/></label><label className="grid gap-1 text-sm">按钮文字<input aria-label={`卡片按钮文字 ${index+1}-${cardIndex+1}`} value={String(card.actionLabel??'')} maxLength={40} onChange={event=>updateCard({actionLabel:event.target.value})} className="min-h-10 min-w-0 rounded-lg border bg-background px-3"/></label><label className="grid gap-1 text-sm md:col-span-2">卡片说明<textarea aria-label={`卡片说明 ${index+1}-${cardIndex+1}`} value={String(card.description??'')} maxLength={300} onChange={event=>updateCard({description:event.target.value})} className="min-h-16 min-w-0 rounded-lg border bg-background p-3"/></label><label className="grid gap-1 text-sm md:col-span-2">站内跳转路径<input aria-label={`卡片链接 ${index+1}-${cardIndex+1}`} value={String(card.href??'/')} maxLength={200} onChange={event=>updateCard({href:event.target.value})} className="min-h-10 min-w-0 rounded-lg border bg-background px-3"/></label></article>;
        })}
        <button type="button" disabled={!Array.isArray(block.cards)||block.cards.length>=6} onClick={()=>update(index,{cards:[...((Array.isArray(block.cards)?block.cards:[]) as DraftBlock[]),emptyCard()]})} className="min-h-10 rounded-lg border px-3 disabled:opacity-50">添加卡片</button>
      </>:block.type==='IMAGE'?<>
        <label className="block text-sm">站内图片路径<input aria-label={`页面图片路径 ${index+1}`} value={String(block.src??'')} maxLength={300} onChange={event=>update(index,{src:event.target.value})} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3" placeholder="/brand/cover.svg 或 /uploads/站点素材.png"/></label>
        <label className="block text-sm">图片替代文字<input aria-label={`图片替代文字 ${index+1}`} value={String(block.alt??'')} maxLength={160} onChange={event=>update(index,{alt:event.target.value})} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3"/></label>
        <label className="block text-sm">图片说明<input aria-label={`图片说明 ${index+1}`} value={String(block.caption??'')} maxLength={240} onChange={event=>update(index,{caption:event.target.value})} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3"/></label>
      </>:block.type==='LIST'?<>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(block.ordered)} onChange={event=>update(index,{ordered:event.target.checked})}/>使用编号列表</label>
        {((Array.isArray(block.items)?block.items:[]) as string[]).map((item,itemIndex)=><div key={itemIndex} className="flex min-w-0 gap-2"><input aria-label={`列表内容 ${index+1}-${itemIndex+1}`} value={String(item)} maxLength={240} onChange={event=>update(index,{items:(block.items as string[]).map((value,i)=>i===itemIndex?event.target.value:value)})} className="min-h-10 min-w-0 flex-1 rounded-lg border bg-background px-3"/><button type="button" disabled={(block.items as string[]).length<=1} onClick={()=>update(index,{items:(block.items as string[]).filter((_,i)=>i!==itemIndex)})} className="min-h-10 rounded border px-3 text-xs disabled:opacity-50">移除</button></div>)}
        <button type="button" disabled={(block.items as string[]).length>=20} onClick={()=>update(index,{items:[...(block.items as string[]),'']})} className="min-h-10 rounded-lg border px-3 disabled:opacity-50">添加列表项</button>
      </>:<>
        <label className="block text-sm">{block.type==='BUTTON'?'按钮文字':block.type==='LINK'?'链接文字':block.type==='HEADING'?'标题文字':block.type==='NOTICE'?'提示内容':'正文文字'}<textarea aria-label={`页面组件文字 ${index+1}`} value={String(block.text??'')} maxLength={block.type==='NOTICE'?1000:block.type==='HEADING'?100:3000} onChange={event=>update(index,{text:event.target.value})} className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3"/></label>
        {block.type==='HEADING'&&<label className="grid gap-1 text-sm">标题级别<select aria-label={`页面标题级别 ${index+1}`} value={String(block.level??2)} onChange={event=>update(index,{level:Number(event.target.value)})} className="min-h-10 w-full rounded-lg border bg-background px-3"><option value="2">二级标题</option><option value="3">三级标题</option></select></label>}
        {(block.type==='LINK'||block.type==='BUTTON')&&<label className="grid gap-1 text-sm">站内跳转路径<input aria-label={`页面组件链接 ${index+1}`} value={String(block.href??'/')} maxLength={200} onChange={event=>update(index,{href:event.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"/></label>}
        {block.type==='BUTTON'&&<label className="grid gap-1 text-sm">按钮样式<select aria-label={`按钮样式 ${index+1}`} value={String(block.variant??'PRIMARY')} onChange={event=>update(index,{variant:event.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"><option value="PRIMARY">主按钮</option><option value="SECONDARY">次按钮</option></select></label>}
        {block.type==='NOTICE'&&<label className="grid gap-1 text-sm">提示样式<select aria-label={`提示样式 ${index+1}`} value={String(block.tone??'INFO')} onChange={event=>update(index,{tone:event.target.value})} className="min-h-10 w-full rounded-lg border bg-background px-3"><option value="INFO">普通提示</option><option value="WARNING">提醒</option></select></label>}
      </>}
    </section>)}
    <button type="button" onClick={()=>commit([...blocks,emptyBlock('PARAGRAPH')])} disabled={blocks.length>=30} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">添加内容组件</button>
    <p className="text-xs text-muted-foreground">组件仅生成标题、正文、图片、列表、站内链接、行动按钮、提示和卡片网格，不接受 HTML、脚本或任意 React 代码；图片只接受站点素材，链接只接受站内路径。</p>
  </div>;
}
