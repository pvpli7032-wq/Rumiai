/**
 * 来源 IP：反代后面只认 X-Forwarded-For 的第一段，不解析整条链。
 *
 * 只用来做限流分层（埋点上报、Mirror 匿名额度），不当作身份：链上任何一段
 * 都可以由客户端伪造，所以它只参与「同一来源刷得太快」的判断，
 * 绝不写进业务归属字段。
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || null;
}
