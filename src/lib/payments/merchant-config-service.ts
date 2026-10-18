import {randomUUID} from 'node:crypto';
import {normalizePaymentRsaCredentials} from './rsa-credentials';
import {isCheckoutEnabled} from './checkout-policy-service';
import {getPublicSiteOrigin} from './ezfp-v2';
import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {decryptMerchantValue, encryptMerchantValue} from './merchant-secrets';

type MerchantPermission =
  | 'payments.merchants.read'
  | 'payments.merchants.manage'
  | 'payments.merchants.secrets.manage'
  | 'payments.merchants.test';
type MerchantEnvironment = 'TEST' | 'PRODUCTION';
type SecretParts = {
  privateKeyCiphertext: string;
  privateKeyNonce: string;
  privateKeyTag: string;
  platformKeyCiphertext: string;
  platformKeyNonce: string;
  platformKeyTag: string;
};

export type PaymentRuntimeConfiguration = {
  revisionId: string | null;
  pid: string;
  privateKey: string;
  publicKey: string;
  baseUrl: string;
  refundsEnabled?: boolean;
  environment: string;
};

export class PaymentMerchantError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PaymentMerchantError';
  }
}

const publicSelect = {
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

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new PaymentMerchantError(`${label}格式无效。`);
  }
  return value.trim();
}

async function permission(
  actor: string,
  key: MerchantPermission,
  tx?: Parameters<typeof hasAdminPermission>[2],
) {
  if (!await hasAdminPermission(actor, key, tx)) {
    throw new PaymentMerchantError('当前账号没有此管理权限。', 403);
  }
}

function validEndpoint(value: unknown, environment: MerchantEnvironment) {
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

function secretData(row: SecretParts) {
  return {
    merchantPrivateKey: decryptMerchantValue({
      ciphertext: row.privateKeyCiphertext,
      nonce: row.privateKeyNonce,
      tag: row.privateKeyTag,
    }),
    platformPublicKey: decryptMerchantValue({
      ciphertext: row.platformKeyCiphertext,
      nonce: row.platformKeyNonce,
      tag: row.platformKeyTag,
    }),
  };
}

function validateRsaCredentials(privateKey: string, platformKey: string) {
  try {
    return normalizePaymentRsaCredentials(privateKey, platformKey);
  } catch (error) {
    throw new PaymentMerchantError(error instanceof Error ? error.message : '支付密钥格式无效。');
  }
}

async function snapshotLegacyEnvironment(tx: Prisma.TransactionClient, actor: string): Promise<boolean | null> {
  const env = process.env;
  if (
    env.EZFP_ENABLED !== 'true'
    || !/^\d+$/.test(env.EZFP_PID?.trim() ?? '')
    || !env.EZFP_MERCHANT_PRIVATE_KEY?.trim()
    || !env.EZFP_PLATFORM_PUBLIC_KEY?.trim()
  ) {
    return null;
  }

  if (await tx.paymentMerchant.findUnique({where: {id: 'legacy_env_ezfp'}})) {
    return true;
  }

  let privateSecret: ReturnType<typeof encryptMerchantValue>;
  let platformSecret: ReturnType<typeof encryptMerchantValue>;
  try {
    privateSecret = encryptMerchantValue(env.EZFP_MERCHANT_PRIVATE_KEY.trim());
    platformSecret = encryptMerchantValue(env.EZFP_PLATFORM_PUBLIC_KEY.trim());
  } catch {
    return false;
  }

  const merchant = await tx.paymentMerchant.create({
    data: {
      id: 'legacy_env_ezfp',
      name: 'Legacy EZFP 环境配置',
      provider: 'EZFP',
      environment: 'PRODUCTION',
      isActive: false,
      version: 1,
    },
  });
  const revision = await tx.paymentMerchantRevision.create({
    data: {
      id: randomUUID(),
      merchantId: merchant.id,
      revision: 1,
      merchantNo: env.EZFP_PID!.trim(),
      apiBaseUrl: env.NODE_ENV === 'production'
        ? 'https://www.ezfp.cn'
        : env.EZFP_API_BASE_URL?.trim() || 'https://www.ezfp.cn',
      privateKeyCiphertext: privateSecret.ciphertext,
      privateKeyNonce: privateSecret.nonce,
      privateKeyTag: privateSecret.tag,
      platformKeyCiphertext: platformSecret.ciphertext,
      platformKeyNonce: platformSecret.nonce,
      platformKeyTag: platformSecret.tag,
      refundsEnabled: env.EZFP_REFUNDS_ENABLED === 'true',
      createdBy: actor,
    },
  });
  await tx.paymentMerchant.update({
    where: {id: merchant.id},
    data: {currentRevisionId: revision.id},
  });
  await recordAdminAudit(
    tx,
    actor,
    'SNAPSHOT_LEGACY_PAYMENT_CONFIG',
    merchant.id,
    '保留旧环境支付配置快照',
    {revision: 1, credentialsEncrypted: true},
  );
  return true;
}

export async function readPaymentMerchants(actor: string) {
  await permission(actor, 'payments.merchants.read');
  await pragmasReady;

  return db.$transaction(async tx => {
    await permission(actor, 'payments.merchants.read', tx);
    const rows = await tx.paymentMerchant.findMany({
      select: {
        ...publicSelect,
        currentRevision: {
          select: {
            revision: true,
            merchantNo: true,
            apiBaseUrl: true,
            refundsEnabled: true,
            createdAt: true,
            privateKeyCiphertext: true,
            platformKeyCiphertext: true,
          },
        },
      },
      orderBy: [{updatedAt: 'desc'}, {id: 'asc'}],
      take: 100,
    });

    return rows.map(({currentRevision, ...row}) => ({
      ...row,
      currentRevision: currentRevision
        ? {
            revision: currentRevision.revision,
            merchantNo: currentRevision.merchantNo,
            apiBaseUrl: currentRevision.apiBaseUrl,
            refundsEnabled: currentRevision.refundsEnabled,
            createdAt: currentRevision.createdAt,
            hasMerchantPrivateKey: Boolean(currentRevision.privateKeyCiphertext),
            hasPlatformPublicKey: Boolean(currentRevision.platformKeyCiphertext),
          }
        : null,
    }));
  });
}

type MerchantInput = {
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

export async function savePaymentMerchant(actor: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PaymentMerchantError('商户配置格式无效。');
  }

  const row = input as MerchantInput & Record<string, unknown>;
  const allowed = new Set([
    'id', 'name', 'environment', 'isActive', 'version', 'merchantNo',
    'apiBaseUrl', 'merchantPrivateKey', 'platformPublicKey', 'refundsEnabled', 'reason',
  ]);
  if (Object.keys(row).some(key => !allowed.has(key))) {
    throw new PaymentMerchantError('商户字段与表单不匹配。');
  }

  const name = text(row.name, '商户名称', 60);
  if (row.environment !== 'TEST' && row.environment !== 'PRODUCTION') {
    throw new PaymentMerchantError('商户环境无效。');
  }
  const environment: MerchantEnvironment = row.environment;
  if (typeof row.isActive !== 'boolean' || typeof row.refundsEnabled !== 'boolean') {
    throw new PaymentMerchantError('启用或退款开关无效。');
  }
  const isActive = row.isActive;
  const refundsEnabled = row.refundsEnabled;
  if (isActive && environment !== 'PRODUCTION') {
    throw new PaymentMerchantError('本机模拟商户不能作为正式支付配置启用。');
  }

  const merchantNo = text(row.merchantNo, '商户编号', 30);
  if (!/^\d{1,30}$/.test(merchantNo)) {
    throw new PaymentMerchantError('EZFP 商户编号必须为数字。');
  }
  const apiBaseUrl = validEndpoint(row.apiBaseUrl, environment);
  const reason = text(row.reason, '操作理由', 300);
  const id = row.id === undefined ? undefined : text(row.id, '商户编号', 100);
  if (row.version !== undefined && (!Number.isSafeInteger(row.version) || (row.version as number) < 0)) {
    throw new PaymentMerchantError('配置版本无效。');
  }

  const suppliedPrivateKey = typeof row.merchantPrivateKey === 'string' ? row.merchantPrivateKey.trim() : '';
  const suppliedPlatformKey = typeof row.platformPublicKey === 'string' ? row.platformPublicKey.trim() : '';
  const credentialsChanged = Boolean(suppliedPrivateKey || suppliedPlatformKey || !id);
  if (credentialsChanged) {
    await permission(actor, 'payments.merchants.secrets.manage');
  }
  await permission(actor, 'payments.merchants.manage');

  const version = id ? row.version as number : 0;

  try {
    await pragmasReady;
    const before = id
      ? await db.paymentMerchant.findUnique({where: {id}, include: {currentRevision: true}})
      : null;
    if (id && !before) {
      throw new PaymentMerchantError('商户配置不存在。', 404);
    }
    if ((before?.version ?? 0) !== version) {
      throw new PaymentMerchantError('商户配置已变化，请刷新后重试。', 409);
    }

    const merchantPrivateKey = suppliedPrivateKey
      || (before?.currentRevision ? secretData(before.currentRevision).merchantPrivateKey : '');
    const platformPublicKey = suppliedPlatformKey
      || (before?.currentRevision ? secretData(before.currentRevision).platformPublicKey : '');
    if (!merchantPrivateKey || !platformPublicKey) {
      throw new PaymentMerchantError('请填写商户私钥和平台公钥。');
    }
    const normalized = validateRsaCredentials(merchantPrivateKey, platformPublicKey);
    const encryptedPrivateKey = encryptMerchantValue(normalized.merchantPrivateKey);
    const encryptedPlatformKey = encryptMerchantValue(normalized.platformPublicKey);

    return await db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actor}`;
      await permission(actor, 'payments.merchants.manage', tx);
      if (credentialsChanged) {
        await permission(actor, 'payments.merchants.secrets.manage', tx);
      }

      const current = id
        ? await tx.paymentMerchant.findUnique({where: {id}, include: {currentRevision: true}})
        : null;
      if (id && !current) {
        throw new PaymentMerchantError('商户配置不存在。', 404);
      }
      if ((current?.version ?? 0) !== version) {
        throw new PaymentMerchantError('商户配置已被其他管理员修改，请刷新后重试。', 409);
      }
      if (!current && name === 'Legacy EZFP 环境配置') {
        throw new PaymentMerchantError('该商户名称为历史配置保留名称。', 409);
      }

      const legacySnapshot: boolean | null = !current && (await tx.paymentMerchant.count()) === 0
        ? await snapshotLegacyEnvironment(tx, actor)
        : null;
      const anotherActiveMerchant = await tx.paymentMerchant.count({
        where: {
          isActive: true,
          environment: 'PRODUCTION',
          ...(id ? {id: {not: id}} : {}),
        },
      });
      if (isActive && environment === 'PRODUCTION' && anotherActiveMerchant) {
        throw new PaymentMerchantError('当前只允许一个正式商户生效，请先停用其他商户。', 409);
      }

      const activeSlot = isActive && environment === 'PRODUCTION' ? 'PRODUCTION' : null;
      const saved = current
        ? await tx.paymentMerchant.update({
            where: {id: current.id},
            data: {name, environment, provider: 'EZFP', isActive, activeSlot, version: {increment: 1}},
          })
        : await tx.paymentMerchant.create({
            data: {id: randomUUID(), name, environment, provider: 'EZFP', isActive, activeSlot, version: 1},
          });
      const revisionNumber = (current?.currentRevision?.revision ?? 0) + 1;
      const revision = await tx.paymentMerchantRevision.create({
        data: {
          id: randomUUID(),
          merchantId: saved.id,
          revision: revisionNumber,
          merchantNo,
          apiBaseUrl,
          privateKeyCiphertext: encryptedPrivateKey.ciphertext,
          privateKeyNonce: encryptedPrivateKey.nonce,
          privateKeyTag: encryptedPrivateKey.tag,
          platformKeyCiphertext: encryptedPlatformKey.ciphertext,
          platformKeyNonce: encryptedPlatformKey.nonce,
          platformKeyTag: encryptedPlatformKey.tag,
          refundsEnabled,
          createdBy: actor,
        },
      });
      const updated = await tx.paymentMerchant.update({
        where: {id: saved.id},
        data: {currentRevisionId: revision.id},
      });

      await recordAdminAudit(
        tx,
        actor,
        current ? 'UPDATE_PAYMENT_MERCHANT' : 'CREATE_PAYMENT_MERCHANT',
        saved.id,
        reason,
        {
          before: current
            ? {
                name: current.name,
                environment: current.environment,
                isActive: current.isActive,
                revision: current.currentRevision?.revision ?? null,
                version: current.version,
              }
            : null,
          after: {
            name,
            environment,
            isActive,
            revision: revisionNumber,
            refundsEnabled,
            version: updated.version,
            credentialsChanged,
          },
        },
      );

      return {
        id: updated.id,
        name: updated.name,
        provider: updated.provider,
        environment: updated.environment,
        isActive: updated.isActive,
        currentRevision: {
          id: revision.id,
          revision: revisionNumber,
          merchantNo,
          apiBaseUrl,
          refundsEnabled: revision.refundsEnabled,
        },
        version: updated.version,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        legacyOrdersPreservedBySnapshot: legacySnapshot,
      };
    });
  } catch (error) {
    if (error instanceof PaymentMerchantError) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('PAYMENT_MERCHANT_ENCRYPTION_KEY')) {
      throw new PaymentMerchantError('服务器未配置支付密钥加密主密钥，暂时不能保存商户。', 503);
    }
    if ((error as {code?: string})?.code === 'P2002') {
      throw new PaymentMerchantError('商户名称、正式启用槽位或配置版本冲突。', 409);
    }
    throw error;
  }
}

export async function testPaymentMerchant(actor: string, id: string) {
  await permission(actor, 'payments.merchants.test');
  await pragmasReady;
  return db.$transaction(async tx => {
    await permission(actor, 'payments.merchants.test', tx);
    const row = await tx.paymentMerchant.findUnique({where: {id}, include: {currentRevision: true}});
    if (!row?.currentRevision) {
      throw new PaymentMerchantError('商户配置或配置版本不存在。', 404);
    }

    let credentialsValid = false;
    try {
      const pair = secretData(row.currentRevision);
      validateRsaCredentials(pair.merchantPrivateKey, pair.platformPublicKey);
      credentialsValid = true;
    } catch {
      // The check result intentionally does not expose decryption or key parsing details.
    }

    const result = {
      credentialsValid,
      reachable: false,
      realPaymentRequested: false,
      environment: row.environment,
    };
    await recordAdminAudit(tx, actor, 'TEST_PAYMENT_MERCHANT', row.id, '验证商户凭据格式', result);
    return result;
  });
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

  const env = process.env;
  if (
    !/^\d+$/.test(env.EZFP_PID?.trim() ?? '')
    || !env.EZFP_MERCHANT_PRIVATE_KEY?.trim()
    || !env.EZFP_PLATFORM_PUBLIC_KEY?.trim()
  ) {
    return null;
  }
  return {
    revisionId: null,
    pid: env.EZFP_PID!.trim(),
    privateKey: env.EZFP_MERCHANT_PRIVATE_KEY!,
    publicKey: env.EZFP_PLATFORM_PUBLIC_KEY!,
    baseUrl: env.EZFP_API_BASE_URL?.trim() || 'https://www.ezfp.cn',
    environment: 'PRODUCTION',
  };
}

export async function resolveOrderPaymentConfiguration(revisionId: string | null): Promise<PaymentRuntimeConfiguration> {
  if (!revisionId) {
    const legacy = await db.paymentMerchant.findUnique({
      where: {id: 'legacy_env_ezfp'},
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

function resolveLegacyEnvironmentConfiguration(): PaymentRuntimeConfiguration {
  const env = process.env;
  if (
    env.EZFP_ENABLED !== 'true'
    || !/^\d+$/.test(env.EZFP_PID?.trim() ?? '')
    || !env.EZFP_MERCHANT_PRIVATE_KEY?.trim()
    || !env.EZFP_PLATFORM_PUBLIC_KEY?.trim()
  ) {
    throw new Error('payment_configuration_unavailable');
  }
  return {
    revisionId: null,
    pid: env.EZFP_PID!.trim(),
    privateKey: env.EZFP_MERCHANT_PRIVATE_KEY!,
    publicKey: env.EZFP_PLATFORM_PUBLIC_KEY!,
    baseUrl: env.EZFP_API_BASE_URL?.trim() || 'https://www.ezfp.cn',
    refundsEnabled: env.EZFP_REFUNDS_ENABLED === 'true',
    environment: 'PRODUCTION',
  };
}

