import {NextResponse} from 'next/server';
import {CharacterCommentError} from '@/lib/characters/comment-service';

/**
 * 评论相关路由的统一错误出口。
 *
 * 三个评论路由（列表/发布、点赞、改写与删除）此前各写一份同样的判定；
 * 其中一份会带 Retry-After，另两份不带 —— 频率限制一旦落在点赞路径上，
 * 客户端就拿不到该等多久。这里统一按带头的版本，三处行为一致。
 */
export function commentError(error: unknown) {
  if (!(error instanceof CharacterCommentError)) return null;
  const headers = error.retryAfter === undefined ? undefined : {'Retry-After': String(error.retryAfter)};
  return NextResponse.json({error: error.message}, {status: error.status, headers});
}
