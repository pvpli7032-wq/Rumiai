/** Mirror 统一错误：路由据此给出状态码与中文文案，不泄露内部细节。 */
export class MirrorError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'MirrorError';
  }
}
