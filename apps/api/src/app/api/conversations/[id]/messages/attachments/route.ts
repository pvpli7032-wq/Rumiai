import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';
import {ConversationAttachmentError, createUserMediaMessage} from '@rumiai/backend/modules/conversations/attachments/attachment-service';

export async function POST(request: Request, {params}: {params: Promise<{id:string}>}) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    const message = await createUserMediaMessage(user.userId, (await params).id, body);
    return NextResponse.json({message, aiNotice: '附件已保存。当前模型未声明图片理解能力，本条不会调用模型或扣除聊天金币。'}, {status: 201});
  } catch (error) {
    if (error instanceof ConversationAttachmentError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST /api/conversations/[id]/messages/attachments', error);
    return NextResponse.json({error: '附件保存失败，请重试。'}, {status: 500});
  }
}
