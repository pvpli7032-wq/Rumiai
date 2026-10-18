import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {getPublicSiteOrigin} from './ezfp-v2';
import {normalizePaymentRsaCredentials} from './rsa-credentials';

export class CheckoutPolicyError extends Error {
  constructor(message: string, readonly status = 400) {super(message); this.name = 'CheckoutPolicyError';}
}

/** No stored override means legacy deployments retain their existing environment switch. */
async function currentPolicy() {
  await pragmasReady;
  const policy = await db.paymentCheckoutPolicy.findUnique({where: {id: 'primary'}});
  return policy ?? {id: 'primary', enabled: process.env.EZFP_ENABLED === 'true', version: 0, updatedAt: null};
}

export async function isCheckoutEnabled() {return (await currentPolicy()).enabled;}

export async function readCheckoutPolicy(actor: string) {
  if (!await hasAdminPermission(actor, 'payments.merchants.read')) throw new CheckoutPolicyError('当前账号没有支付配置查看权限。', 403);
  return currentPolicy();
}

export async function saveCheckoutPolicy(actor: string, input: unknown) {
  if (!await hasAdminPermission(actor, 'payments.merchants.manage')) throw new CheckoutPolicyError('当前账号没有支付配置管理权限。', 403);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CheckoutPolicyError('充值开关数据格式无效。');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !['enabled', 'version', 'reason'].includes(key)) || typeof row.enabled !== 'boolean' || !Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new CheckoutPolicyError('充值开关或版本无效。');
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.trim().length > 300) throw new CheckoutPolicyError('请填写 1–300 字操作理由。');
  const enabled = row.enabled, version = Number(row.version), reason = row.reason.trim();
  // Resolve lazily: merchant configuration consumes this policy for new checkouts.
  if (enabled) {
    const {resolveConfiguredPaymentMerchant} = await import('./merchant-config-service');
    const merchant = await resolveConfiguredPaymentMerchant();
    if (!merchant) throw new CheckoutPolicyError('请先配置并启用正式支付商户。');
    try {getPublicSiteOrigin(process.env); normalizePaymentRsaCredentials(merchant.privateKey, merchant.publicKey);}
    catch {throw new CheckoutPolicyError('支付密钥或网站回调地址无效，请先完善正式商户配置。');}
  }
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actor}`;
    if (!await hasAdminPermission(actor, 'payments.merchants.manage', tx)) throw new CheckoutPolicyError('当前账号没有支付配置管理权限。', 403);
    const before = await tx.paymentCheckoutPolicy.findUnique({where: {id: 'primary'}});
    if ((before?.version ?? 0) !== version) throw new CheckoutPolicyError('充值开关已被修改，请刷新后重试。', 409);
    const after = await tx.paymentCheckoutPolicy.upsert({where: {id: 'primary'}, create: {id: 'primary', enabled}, update: {enabled, version: {increment: 1}}});
    await recordAdminAudit(tx, actor, 'UPDATE_PAYMENT_CHECKOUT_POLICY', 'payment-checkout:primary', reason, {before: before ?? {enabled: process.env.EZFP_ENABLED === 'true', version: 0}, after});
    return after;
  });
}
