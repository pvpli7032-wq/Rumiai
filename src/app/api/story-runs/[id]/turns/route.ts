import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { AiQuotaError } from '@/lib/ai/ai-usage';
import { executeStoryTurn } from '@/lib/stories/turn-service';
import { assertStoryActionEnabled } from '@/lib/stories/rollout-flags';
import { storyErrorResponse } from '../../errors';

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
    // F2 灰度旗标：须在任何额度预留之前拒绝，轮询 GET turn 不受限。
    assertStoryActionEnabled('STORY_TURNS_DISABLED', '故事回合已暂停，请稍后再试。');
    const body: unknown = await request.json().catch(() => undefined);
    const stream = await executeStoryTurn({userId: auth.userId, runId: (await params).id, input: body, signal: request.signal});
    return new Response(stream, {headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'}});
  } catch (error) {
    if (error instanceof AiQuotaError) return NextResponse.json({error: error.message}, {status: error.status ?? 429, headers: error.retryAfter > 0 ? {'Retry-After': String(error.retryAfter)} : {}});
    return storyErrorResponse(error, 'POST /api/story-runs/[id]/turns');
  }
}
