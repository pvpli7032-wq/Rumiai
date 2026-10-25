'use client';
import {CharacterCard} from '@/components/characters/character-card';
import {RoleplayText} from '@/components/chat/roleplay-text';
export interface PreviewData {name:string;tagline:string;greeting:string;avatarUrl:string;tags:string[];badges:string[];isExclusive:boolean}
export function LivePreview({data,tagLabel}:{data:PreviewData;tagLabel?:(key:string)=>string}){
 return <div className="space-y-4"><p className="text-xs leading-5 text-muted-foreground">样式预览，使用正式角色卡和正文排版；此处不会生成AI回复。</p><div className="mx-auto w-[190px]"><CharacterCard interactive={false} character={{id:'creator-preview',name:data.name||'角色名称',tagline:data.tagline,personality:data.tagline,avatarUrl:data.avatarUrl,chatCount:0,isExclusive:data.isExclusive,badges:data.badges.join(','),tags:data.tags.join(','),tagLabels:data.tags.map(key=>tagLabel?tagLabel(key):key)}}/></div><div className="rounded-xl border border-border bg-card p-3"><h3 className="mb-2 text-xs font-medium text-muted-foreground">开场白预览</h3>{data.greeting?<RoleplayText text={data.greeting}/>:<p className="text-sm text-muted-foreground">填写开场白后在这里预览。</p>}</div></div>;
}
