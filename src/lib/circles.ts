import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export function circleRateLimit(userId: string, action: 'create' | 'membership') {
  const result = checkRateLimit(`circle:${action}:${userId}`, action === 'create' ? 5 : 60, 60_000);
  return result.allowed ? null : NextResponse.json({error:'操作太频繁，请稍后重试。'}, {status:429, headers:{'Retry-After':String(result.retryAfter)}});
}

export const circleSelect = (userId?: string) => ({
  id:true, name:true, description:true, tags:true, createdAt:true,
  owner:{select:{id:true, username:true, displayName:true}},
  universe:{select:{id:true, name:true, isPublic:true}},
  _count:{select:{members:true}},
  ...(userId ? {members:{where:{userId}, select:{userId:true}}} : {}),
} as const);

export function publicCircle(row: any) {
  const {members, _count, universe, ...circle}=row;
  return {...circle, universe:universe?.isPublic ? {id:universe.id,name:universe.name} : null,
    subscriberCount:_count.members, subscribed:Boolean(members?.length)};
}

export async function validateCircle(input: unknown) {
  if(!input || typeof input!=='object' || Array.isArray(input)) return {error:'圈子数据格式不正确。'};
  const body=input as Record<string,unknown>;
  if(typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>40) return {error:'圈子名称须为 1–40 个字符。'};
  if(typeof body.description!=='string' || !body.description.trim() || body.description.trim().length>1000) return {error:'圈子介绍须为 1–1000 个字符。'};
  if(body.tags!==undefined && (typeof body.tags!=='string' || body.tags.length>200)) return {error:'标签须为不超过 200 字符的文字。'};
  const tags=typeof body.tags==='string' ? [...new Set(body.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean))] : [];
  if(tags.length>10 || tags.some(t=>t.length>20)) return {error:'最多 10 个标签，每个不超过 20 字符。'};
  const universeId=body.universeId;
  if(universeId!==undefined && universeId!==null && (typeof universeId!=='string' || universeId.length>100)) return {error:'世界观关联格式不正确。'};
  if(universeId && !await db.universe.findFirst({where:{id:universeId as string,isPublic:true},select:{id:true}})) return {error:'只能关联已公开的世界观。'};
  return {data:{name:body.name.trim(), description:body.description.trim(), tags:tags.join(',')||null, universeId:typeof universeId==='string'&&universeId ? universeId : null}};
}
