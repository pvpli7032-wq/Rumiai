import {hasAdminPermission} from '@/lib/admin/authorization';

/**
 * 商户配置的入参校验与乐观锁（V3 支付章）。
 *
 * 这里的每一条都是「不满足就别写库」的判定：字段格式、权限、版本号。
 * 报错统一用 PaymentMerchantError，路由层靠 status 决定 HTTP 码。
 */

export type MerchantPermission =
  | 'payments.merchants.read'
  | 'payments.merchants.manage'
  | 'payments.merchants.secrets.manage'
  | 'payments.merchants.test';
export type MerchantEnvironment = 'TEST' | 'PRODUCTION';

export class PaymentMerchantError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PaymentMerchantError';
  }
}

/** 列表返回的公开字段；密钥密文只用来判断「有没有」，不对外。 */
export const publicSelect = {
  id: true,
  name: true,
  provider: true,
  environment: true,
  isActive: true,
  currentRevisionId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type MerchantInput = {
  id?: string;
  name?: unknown;
  environment?: unknown;
  isActive?: unknown;
  version?: unknown;
  merchantNo?: unknown;
  apiBaseUrl?: unknown;
  merchantPrivateKey?: unknown;
  platformPublicKey?: unknown;
  refundsEnabled?: unknown;
  reason?: unknown;
};

export function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new PaymentMerchantError(`${label}格式无效。`);
  }
  return value.trim();
}

export async function permission(
  actor: string,
  key: MerchantPermission,
  tx?: Parameters<typeof hasAdminPermission>[2],
) {
  if (!await hasAdminPermission(actor, key, tx)) {
    throw new PaymentMerchantError('当前账号没有此管理权限。', 403);
  }
}

/**
 * 乐观锁：同一个 id 必须存在且版本号一致。
 * 事务外先探一次、事务内再确认一次，两次的差异只在提示语（第二次说明是并发改动）。
 */
export function assertMerchantVersion(
  id: string | undefined,
  row: {version: number} | null,
  version: number,
  mismatch: string,
) {
  if (id && !row) throw new PaymentMerchantError('商户配置不存在。', 404);
  if ((row?.version ?? 0) !== version) throw new PaymentMerchantError(mismatch, 409);
}

/** 支付服务地址：只允许裸 origin，不允许把凭据、路径或参数塞进地址里。 */
export function validEndpoint(value: unknown, environment: MerchantEnvironment) {
  if (typeof value !== 'string' || value.length > 300) {
    throw new PaymentMerchantError('支付服务地址格式无效。');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new PaymentMerchantError('支付服务地址必须是合法 URL。');
  }

  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/'
    || !['https:', 'http:'].includes(url.protocol)
  ) {
    throw new PaymentMerchantError('支付服务地址不能包含凭据、路径、查询参数或片段。');
  }

  if (environment === 'PRODUCTION' && url.origin !== 'https://www.ezfp.cn') {
    throw new PaymentMerchantError('正式环境仅允许 EZFP 官方支付域名。');
  }

  if (
    environment === 'TEST'
    && (
      process.env.NODE_ENV === 'production'
      || url.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  ) {
    throw new PaymentMerchantError('沙箱地址仅允许非生产环境的本机模拟服务。');
  }

  return url.origin;
}
