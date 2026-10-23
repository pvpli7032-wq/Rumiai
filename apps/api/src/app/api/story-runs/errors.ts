import { NextResponse } from 'next/server';
import { StoryError } from '@rumiai/backend/modules/stories/repository/contracts';
import { logRouteError } from '@rumiai/backend/infrastructure/logging/logger';

export function storyErrorResponse(error: unknown, route: string) {
  if (error instanceof StoryError) return NextResponse.json({error: error.message, code: error.code, ...error.data}, {status: error.status});
  logRouteError(route, error);
  const code = (error as {code?: string} | null)?.code;
  if (code === 'P1008' || code === 'P2028' || code === 'P2034') return NextResponse.json({error: '故事存储暂不可用，请先查询请求结果。', code: 'STORY_STORAGE_UNAVAILABLE'}, {status: 503});
  return NextResponse.json({error: 'Internal server error'}, {status: 500});
}
