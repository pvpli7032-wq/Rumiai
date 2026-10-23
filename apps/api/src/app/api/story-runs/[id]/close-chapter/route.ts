import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {closeChapter} from '@rumiai/backend/modules/stories/lifecycle/chapter-service';
import {assertStoryActionEnabled} from '@rumiai/backend/modules/stories/rollout-flags';
import {storyErrorResponse} from '../../errors';

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    // F3 灰度旗标：只挡结章，resume 恢复与结章门（STATE_NOT_READY 等 422）语义不变。
    assertStoryActionEnabled('STORY_CLOSE_DISABLED', '结章操作已暂停，请稍后再试。');
    const body: unknown = await request.json().catch(() => undefined);
    const result = await closeChapter(auth.userId, (await params).id, body);
    return NextResponse.json(result);
  } catch (error) {
    return storyErrorResponse(error, 'POST /api/story-runs/[id]/close-chapter');
  }
}
