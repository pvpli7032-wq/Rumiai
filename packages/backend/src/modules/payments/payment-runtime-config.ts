import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {isCheckoutEnabled} from './checkout-policy-service';
import {getPublicSiteOrigin} from './ezfp-v2';
import {secretData} from './merchant-credentials';

/**
 * 生效中的支付配置：下单、退款、对账都从这里取 pid 与密钥。
 *
 * 优先用后台登记的正式商户版本（新订单固定引用 revisionId）；没有后台配置时
 * 回落到服务器环境变量（旧订单与历史部署仍要走得通）。
 */

export const EZFP_OFFICIAL_ORIGIN = 'https://www.ezfp.cn';

/** 旧环境配置快照固定的商户 id 与名称：下单兜底、创建快照、保留名检查共用一处。 */
export const LEGACY_ENV_MERCHANT_ID = 'legacy_env_ezfp';
export const LEGACY_ENV_MERCHANT_NAME = 'Legacy EZFP 环境配置';

export type PaymentRuntimeConfiguration = {
  revisionId: string | null;
  pid: string;
  privateKey: string;
  publicKey: string;
  baseUrl: string;
  refundsEnabled?: boolean;
  environment: string;
};

export type LegacyEnvCredentials = {
  enabled: boolean;
  pid: string;
  privateKey: string;
  publicKey: string;
  baseUrl: string;
  refundsEnabled: boolean;
};

/**
 * 读服务器环境里的 EZFP 凭据；三项缺一或 pid 不是数字就返回 null。
 *
 * 密钥保持原样返回（不 trim）：调用方历来按自己的需要处理，统一 trim 会改变
 * 传给签名函数的字符串。是否启用单独放在 enabled 里，因为历史快照与下单
 * 两条路径对 EZFP_ENABLED 的要求本来就不同。
 */
export function readLegacyEnvCredentials(): LegacyEnvCredentials | null {
  const env = process.env;
  const pid = env.EZFP_PID?.trim() ?? '';
  const privateKey = env.EZFP_MERCHANT_PRIVATE_KEY ?? '';
  const publicKey = env.EZFP_PLATFORM_PUBLIC_KEY ?? '';
  if (!/^\d+$/.test(pid) || !privateKey.trim() || !publicKey.trim()) return null;
  return {
    enabled: env.EZFP_ENABLED === 'true',
    pid,
    privateKey,
    publicKey,
    baseUrl: env.EZFP_API_BASE_URL?.trim() || EZFP_OFFICIAL_ORIGIN,
    refundsEnabled: env.EZFP_REFUNDS_ENABLED === 'true',
  };
}

export async function resolveNewPaymentConfiguration(): Promise<PaymentRuntimeConfiguration | null> {
  if (!await isCheckoutEnabled()) return null;
  try {getPublicSiteOrigin(process.env);} catch {return null;}
  return resolveConfiguredPaymentMerchant();
}

export async function readCheckoutAvailability() {
  if (!await isCheckoutEnabled()) return {enabled: false, reason: 'CHECKOUT_DISABLED'} as const;
  const configured = await resolveNewPaymentConfiguration();
  return configured ? {enabled: true, reason: 'READY'} as const : {enabled: false, reason: 'MERCHANT_UNAVAILABLE'} as const;
}

/** Configuration only; does not bypass the checkout policy when creating orders. */
export async function resolveConfiguredPaymentMerchant(): Promise<PaymentRuntimeConfiguration | null> {
  await pragmasReady;

  if (await db.paymentMerchant.count()) {
    const active = await db.paymentMerchant.findFirst({
      where: {provider: 'EZFP', environment: 'PRODUCTION', isActive: true},
      include: {currentRevision: true},
    });
    if (!active?.currentRevision) {
      return null;
    }
    try {
      const pair = secretData(active.currentRevision);
      return {
        revisionId: active.currentRevision.id,
        pid: active.currentRevision.merchantNo,
        privateKey: pair.merchantPrivateKey,
        publicKey: pair.platformPublicKey,
        baseUrl: active.currentRevision.apiBaseUrl,
        refundsEnabled: active.currentRevision.refundsEnabled,
        environment: active.environment,
      };
    } catch {
      return null;
    }
  }

  const credentials = readLegacyEnvCredentials();
  if (!credentials) return null;
  return {
    revisionId: null,
    pid: credentials.pid,
    privateKey: credentials.privateKey,
    publicKey: credentials.publicKey,
    baseUrl: credentials.baseUrl,
    environment: 'PRODUCTION',
  };
}

export async function resolveOrderPaymentConfiguration(revisionId: string | null): Promise<PaymentRuntimeConfiguration> {
  if (!revisionId) {
    const legacy = await db.paymentMerchant.findUnique({
      where: {id: LEGACY_ENV_MERCHANT_ID},
      include: {currentRevision: true},
    });
    if (legacy?.currentRevision) {
      return resolveOrderPaymentConfiguration(legacy.currentRevision.id);
    }
    return resolveLegacyEnvironmentConfiguration();
  }

  const revision = await db.paymentMerchantRevision.findUnique({where: {id: revisionId}});
  if (!revision) {
    throw new Error('payment_merchant_revision_missing');
  }
  const pair = secretData(revision);
  const merchant = await db.paymentMerchant.findUnique({
    where: {id: revision.merchantId},
    select: {environment: true},
  });
  return {
    revisionId: revision.id,
    pid: revision.merchantNo,
    privateKey: pair.merchantPrivateKey,
    publicKey: pair.platformPublicKey,
    baseUrl: revision.apiBaseUrl,
    refundsEnabled: revision.refundsEnabled,
    environment: merchant?.environment ?? 'PRODUCTION',
  };
}

/** 旧订单兜底：只有环境配置齐全且显式启用时才可用。 */
export function resolveLegacyEnvironmentConfiguration(): PaymentRuntimeConfiguration {
  const credentials = readLegacyEnvCredentials();
  if (!credentials?.enabled) {
    throw new Error('payment_configuration_unavailable');
  }
  return {
    revisionId: null,
    pid: credentials.pid,
    privateKey: credentials.privateKey,
    publicKey: credentials.publicKey,
    baseUrl: credentials.baseUrl,
    refundsEnabled: credentials.refundsEnabled,
    environment: 'PRODUCTION',
  };
}
