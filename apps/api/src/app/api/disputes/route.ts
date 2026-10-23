import {NextResponse} from 'next/server';
import {getAuthUser} from '@rumiai/backend/infrastructure/auth/auth';
import {createDisputeCase, listDisputeCases} from '@rumiai/backend/modules/disputes/case-service';
import {enqueueCloseIfReached} from '@rumiai/backend/modules/disputes/close-service';
import type {DisputeSort} from '@rumiai/contracts/disputes/types';
import {disputeError, readJson} from './_response';

export const dynamic = 'force-dynamic';

const NO_STORE = {'Cache-Control': 'private, no-store'};

/** 列表：热门 / 最新 / 我参与的。匿名可看前两种。 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const auth = await getAuthUser(request);
    const sort = (url.searchParams.get('sort') ?? 'hot') as DisputeSort;
    if (!['hot', 'latest', 'joined'].includes(sort)) return NextResponse.json({error: '排序方式无效。'}, {status: 400});
    const page = await listDisputeCases({sort, cursor: url.searchParams.get('cursor'), limit: Number(url.searchParams.get('limit')) || 20, userId: auth?.userId ?? null});
    return NextResponse.json(page, {headers: NO_STORE});
  } catch (error) {
    return disputeError(error, '评理列表加载失败，请稍后重试。', 'GET /api/disputes');
  }
}

/** 发起：从自己的聊天选连续消息 + 诉求；规则写进快照，响应只回案例与下一步地址。 */
export async function POST(request: Request) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({error: '请先登录。'}, {status: 401});
    const parsed = await readJson(request);
    if (parsed.response) return parsed.response;
    const result = await createDisputeCase(auth.userId, parsed.input);
    // 创建那一刻就可能已经到截止时间（后台把时长调得很短）：登记一次结案任务，生成交给任务进程。
    await enqueueCloseIfReached(result.caseId).catch(() => false);
    return NextResponse.json({caseId: result.caseId, postId: result.postId, rules: result.snapshot}, {status: 201, headers: NO_STORE});
  } catch (error) {
    return disputeError(error, '发起评理失败，请稍后重试。', 'POST /api/disputes');
  }
}
