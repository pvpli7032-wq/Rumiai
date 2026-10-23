import { NextResponse } from 'next/server';
import { getAuthUser } from '@rumiai/backend/infrastructure/auth/auth';
import { checkRateLimit } from '@rumiai/backend/infrastructure/http/rate-limit';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';
import { readCommunityWriteRestriction } from '@rumiai/backend/modules/community/restriction-service';
import { readRateLimitRules } from '@rumiai/backend/modules/settings/limits';
import {CreatorFollowError,followCreator,resolveCreatorFollowTarget,unfollowCreator} from '@rumiai/backend/modules/creators/follow-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: '请先登录后关注创作者。' }, { status: 401 });
    const restriction = await readCommunityWriteRestriction(auth.userId);
    if (restriction) return NextResponse.json({error:'你的社区发言权限暂时受限。可在社区申诉入口提交复核。',reason:restriction.reason},{status:403});
    const target = await resolveCreatorFollowTarget(auth.userId,params.username,true);
    const rules = await readRateLimitRules();
    const limit = checkRateLimit(`creator-follow:${auth.userId}`, rules.follow.perWindow, rules.follow.windowMs);
    if (!limit.allowed) return NextResponse.json({ error: '关注操作太频繁，请稍后重试。' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    return NextResponse.json(await followCreator(auth.userId,target.id),{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {if(error instanceof CreatorFollowError)return NextResponse.json({error:error.message},{status:error.status});logRouteError('POST /api/creators/[username]/follow', error); return NextResponse.json({ error: '关注失败，请稍后重试。' }, { status: 500 }); }
}

export async function DELETE(request: Request, { params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: '请先登录后操作。' }, { status: 401 });
    const target = await resolveCreatorFollowTarget(auth.userId,params.username);
    const rules = await readRateLimitRules();
    const limit = checkRateLimit(`creator-follow:${auth.userId}`, rules.follow.perWindow, rules.follow.windowMs);
    if (!limit.allowed) return NextResponse.json({ error: '关注操作太频繁，请稍后重试。' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    return NextResponse.json(await unfollowCreator(auth.userId,target.id),{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {if(error instanceof CreatorFollowError)return NextResponse.json({error:error.message},{status:error.status});logRouteError('DELETE /api/creators/[username]/follow', error); return NextResponse.json({ error: '取消关注失败，请稍后重试。' }, { status: 500 }); }
}
