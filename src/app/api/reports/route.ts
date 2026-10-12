import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  CONTACT_TYPES,
  COPYRIGHT_RELATIONSHIPS,
  IMAGE_REASONS,
  MAX_DETAILS,
  REPORT_CATEGORIES,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  REPORT_TARGET_TYPES,
  isReportCategory,
  isReportTargetType,
} from '@/lib/reports';

export const dynamic='force-dynamic';

const oneOf = (list: readonly string[], value: unknown) =>
  typeof value === 'string' && list.includes(value) ? value : undefined;

/** The reporter's own filings. Nobody else's reports are visible here. */
export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const reports = await db.report.findMany({
      where: { reporterId: authUser.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        category: true,
        imageReason: true,
        details: true,
        evidenceContent: true,
        // A copyright claim's evidence is part of the filing; without these the reporter
        // could not see what they had actually submitted.
        workTitle: true,
        relationship: true,
        sourceLink: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json(reports,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    logRouteError('GET /api/reports', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * File a report. A platform carrying adult user-generated content has to have a way to
 * hear about illegal material, so this stays deliberately easy to reach — but a second
 * report from the same person about the same thing updates the first rather than
 * stacking up, so one determined account cannot manufacture the appearance of many
 * complaints.
 */
export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body:any;try{body=await request.json()}catch{return NextResponse.json({error:'举报数据格式不正确。'},{status:400})}
    if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'举报数据格式不正确。'},{status:400});
    let evidenceContent:string|null=null;
    const targetType = (body.targetType ?? body.target_type ?? '').toString().toUpperCase();
    const targetId = typeof (body.targetId ?? body.target_id) === 'string' ? (body.targetId ?? body.target_id).trim() : '';
    const category = body.category;
    const details = typeof body.details === 'string' ? body.details.trim() : '';

    if (!isReportTargetType(targetType)) {
      return NextResponse.json(
        { error: `targetType must be one of ${REPORT_TARGET_TYPES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!targetId) return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
    if (!isReportCategory(category)) {
      return NextResponse.json(
        { error: `category must be one of ${REPORT_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }
    // Every category except "other" already says what the complaint is, and demanding a
    // written explanation on top of it is friction that suppresses reports of exactly the
    // content a platform most needs to hear about. "other" carries no information on its
    // own, so it still has to be explained.
    if (category === 'other' && !details) {
      return NextResponse.json({ error: 'details is required for the "other" category' }, { status: 400 });
    }
    if (details.length > MAX_DETAILS) {
      return NextResponse.json({ error: `details must be ${MAX_DETAILS} characters or fewer` }, { status: 400 });
    }

    // Refuse a report against something that does not exist, so the queue stays about
    // real content. Only the types this app actually stores are checked.
    if (targetType === 'CHARACTER') {
      const exists = await db.character.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    } else if (targetType === 'MESSAGE') {
      const message=await db.message.findUnique({where:{id:targetId},select:{content:true,role:true,conversation:{select:{userId:true}}}});
      if(!message)return NextResponse.json({error:'消息不存在。'},{status:404});
      if(message.conversation.userId!==authUser.userId)return NextResponse.json({error:'只能举报自己对话中的 AI 回复。'},{status:403});
      if(message.role!=='ASSISTANT')return NextResponse.json({error:'此入口用于举报 AI 回复。'},{status:400});
      evidenceContent=message.content;
    } else if (targetType === 'USER') {
      const exists = await db.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    } else if (targetType === 'POST') {
      const post = await db.post.findUnique({ where: { id: targetId }, select: { content: true, media: { orderBy: { position: 'asc' }, select: { url: true } } } });
      if (!post) return NextResponse.json({ error: '帖子不存在。' }, { status: 404 });
      evidenceContent = post.content + (post.media.length ? '\n\n图片：\n' + post.media.map(image => image.url).join('\n') : '');
    } else if (targetType === 'POST_COMMENT') {
      const comment = await db.postComment.findUnique({ where: { id: targetId }, select: { content: true, imageUrl: true } });
      if (!comment) return NextResponse.json({ error: '评论不存在。' }, { status: 404 });
      evidenceContent = comment.content + (comment.imageUrl ? '\n\n图片：\n' + comment.imageUrl : '');
    }

    const limit = checkRateLimit(`report:${authUser.userId}`, REPORT_RATE_LIMIT, REPORT_RATE_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: '提交举报过于频繁，请稍后重试。' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
      );
    }

    const data = {
      reporterId: authUser.userId,
      targetType,
      targetId,
      category,
      details,
      evidenceContent,
      imageReason: category === 'inappropriateImage' ? oneOf(IMAGE_REASONS, body.imageReason ?? body.image_reason) ?? null : null,
      // Only a copyright claim carries provenance; the other categories leave it null.
      workTitle:
        category === 'copyright'
          ? typeof (body.workTitle ?? body.work_title) === 'string'
            ? (body.workTitle ?? body.work_title).trim()
            : null
          : null,
      relationship: category === 'copyright' ? oneOf(COPYRIGHT_RELATIONSHIPS, body.relationship) ?? null : null,
      sourceLink:
        category === 'copyright'
          ? typeof (body.sourceLink ?? body.source_link) === 'string'
            ? (body.sourceLink ?? body.source_link).trim()
            : null
          : null,
      contactType: oneOf(CONTACT_TYPES, body.contactType ?? body.contact_type) ?? null,
      contactValue: typeof (body.contactValue ?? body.contact_value) === 'string' ? (body.contactValue ?? body.contact_value).trim() : null,
    };

    // SQLite starts this write transaction before the lookup, so parallel duplicate
    // submissions update one report rather than creating multiple queue entries.
    const result=await db.$transaction(async tx=>{
      const existing=await tx.report.findFirst({where:{reporterId:authUser.userId,targetType,targetId},select:{id:true}});
      const report=existing?await tx.report.update({where:{id:existing.id},data:{...data,status:'OPEN'},select:{id:true,status:true,createdAt:true}}):await tx.report.create({data,select:{id:true,status:true,createdAt:true}});
      return {report,updated:Boolean(existing)};
    });
    return NextResponse.json({success:true,...result},{status:result.updated?200:201});

  } catch (error) {
    logRouteError('POST /api/reports', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
