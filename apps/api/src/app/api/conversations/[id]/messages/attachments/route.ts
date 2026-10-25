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
    return NextResponse.json({message, aiNotice: '附件已保存；如需图片理解或语音转写，请在附件工具中单独操作。'}, {status: 201});
  } catch (error) {
    if (error instanceof ConversationAttachmentError) return NextResponse.json({error: error.message}, {status: error.status});
    logRouteError('POST /api/conversations/[id]/messages/attachments', error);
    return NextResponse.json({error: '附件保存失败，请重试。'}, {status: 500});
  }
}
