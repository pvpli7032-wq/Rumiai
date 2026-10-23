/**
 * HTTP 状态码到机器码的映射。放在这里而不是 `errors.ts`，是因为客户端也要用：
 * `errors.ts` 依赖 `next/server`，客户端组件不能引入。
 */
export const STATUS_CODES: Record<number, string> = {
  400: 'INVALID_INPUT',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'INVALID_INPUT',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
  502: 'UPSTREAM_FAILED',
  503: 'UNAVAILABLE',
};

/** 旧接口只返回 `{error}` 没有 `code`，客户端按状态码兜底。 */
export function statusCode(status: number): string {
  return STATUS_CODES[status] ?? `HTTP_${status}`;
}
