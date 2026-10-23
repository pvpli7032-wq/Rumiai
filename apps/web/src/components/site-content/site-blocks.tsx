import Link from 'next/link';
import Image from 'next/image';
import type {SitePageBlock} from '@web/lib/use-site-content';

export function SiteBlocks({blocks,previewPageId,draftPreview=false}:{blocks:SitePageBlock[];previewPageId?:string;draftPreview?:boolean}) {
  return <div className="mt-6 space-y-4">{blocks.map((block,index)=>{
    if(block.type==='HEADING')return block.level===3?<h2 key={index} className="mt-6 text-xl font-semibold">{block.text}</h2>:<h2 key={index} className="mt-8 text-2xl font-semibold">{block.text}</h2>;
    if(block.type==='LINK')return <p key={index}><Link href={block.href??'/'} className="min-h-11 inline-flex items-center text-orange-500 underline underline-offset-4">{block.text}</Link></p>;
    if(block.type==='NOTICE')return <aside key={index} className={`rounded-xl border p-4 ${block.tone==='WARNING'?'border-amber-500/40 bg-amber-500/10':'border-blue-500/30 bg-blue-500/10'}`}>{block.text}</aside>;
    if(block.type==='BUTTON')return <p key={index}><Link href={block.href} className={`min-h-11 inline-flex items-center rounded-lg px-5 font-medium ${block.variant==='PRIMARY'?'bg-primary text-primary-foreground':'border border-border bg-card'}`}>{block.text}</Link></p>;
    if(block.type==='CARD_GRID')return <section key={index} className="space-y-4"><h2 className="text-xl font-semibold">{block.heading}</h2><div className="grid gap-3 sm:grid-cols-2">{block.cards.map((card,cardIndex)=><article key={`${card.href}-${cardIndex}`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4"><h3 className="break-words font-semibold">{card.title}</h3>{card.description&&<p className="break-words text-sm leading-6 text-muted-foreground">{card.description}</p>}<Link href={card.href} className="mt-auto min-h-11 inline-flex items-center text-sm font-medium text-orange-500 underline underline-offset-4">{card.actionLabel}</Link></article>)}</div></section>;
    if(block.type==='IMAGE'){
      if(draftPreview&&block.src.startsWith('/uploads/')&&!previewPageId)return <p key={index} role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">保存草稿后可预览站点图片。</p>;
      const src=draftPreview&&block.src.startsWith('/uploads/')?`${block.src}?previewPage=${encodeURIComponent(previewPageId!)}`:block.src;
      return <figure key={index} className="space-y-2"><Image src={src} alt={block.alt} width={1200} height={800} unoptimized loading="lazy" className="h-auto max-h-[32rem] w-full rounded-xl object-cover"/>{block.caption&&<figcaption className="text-center text-sm text-muted-foreground">{block.caption}</figcaption>}</figure>;
    }
    if(block.type==='LIST'){const items=block.items.map((item,itemIndex)=><li key={itemIndex} className="pl-1 leading-7">{item}</li>);return block.ordered?<ol key={index} className="list-inside list-decimal space-y-1">{items}</ol>:<ul key={index} className="list-inside list-disc space-y-1">{items}</ul>;}
    return <p key={index} className="whitespace-pre-wrap break-words leading-7 text-zinc-300">{block.text}</p>;
  })}</div>;
}
