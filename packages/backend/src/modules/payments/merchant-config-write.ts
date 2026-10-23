import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {
  assertMerchantVersion,
  permission,
  text,
  validEndpoint,
  PaymentMerchantError,
  type MerchantEnvironment,
  type MerchantInput,
} from './merchant-guards';
import {encryptRevisionSecrets, encryptSecretParts, secretData} from './merchant-credentials';
import {
  EZFP_OFFICIAL_ORIGIN,
  LEGACY_ENV_MERCHANT_ID,
  LEGACY_ENV_MERCHANT_NAME,
  readLegacyEnvCredentials,
} from './payment-runtime-config';

/**
 * 后台商户配置的写入：每次保存追加一个不可变版本，新订单固定引用该版本。
 *
 * 写入分两段：事务外做入参校验与密钥准备（会调用解密与 RSA 解析，比较慢），
 * 事务内重新确认版本号再落库，避免两个管理员同时改配置时后写的覆盖先写的。
 */

/**
 * 首次出现后台配置时，把环境变量里的旧凭据加密留档。
 *
 * 返回 true 表示旧订单仍引用得到历史凭据；false 表示加密失败，旧订单要继续依赖
 * 环境变量；null 表示环境里本来就没有可快照的配置。
 */
async function snapshotLegacyEnvironment(tx: Prisma.TransactionClient, actor: string): Promise<boolean | null> {
  const credentials = readLegacyEnvCredentials();
  if (!credentials?.enabled) return null;

  if (await tx.paymentMerchant.findUnique({where: {id: LEGACY_ENV_MERCHANT_ID}})) {
    return true;
  }

  let secrets;
  try {
    secrets = encryptSecretParts(credentials.privateKey.trim(), credentials.publicKey.trim());
  } catch {
    return false;
  }

  const merchant = await tx.paymentMerchant.create({
    data: {
      id: LEGACY_ENV_MERCHANT_ID,
      name: LEGACY_ENV_MERCHANT_NAME,
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
      merchantNo: credentials.pid,
      apiBaseUrl: process.env.NODE_ENV === 'production' ? EZFP_OFFICIAL_ORIGIN : credentials.baseUrl,
      ...secrets,
      refundsEnabled: credentials.refundsEnabled,
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
    assertMerchantVersion(id, before, version, '商户配置已变化，请刷新后重试。');

    const merchantPrivateKey = suppliedPrivateKey
      || (before?.currentRevision ? secretData(before.currentRevision).merchantPrivateKey : '');
    const platformPublicKey = suppliedPlatformKey
      || (before?.currentRevision ? secretData(before.currentRevision).platformPublicKey : '');
    if (!merchantPrivateKey || !platformPublicKey) {
      throw new PaymentMerchantError('请填写商户私钥和平台公钥。');
    }
    const secrets = encryptRevisionSecrets(merchantPrivateKey, platformPublicKey);

    return await db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actor}`;
      await permission(actor, 'payments.merchants.manage', tx);
      if (credentialsChanged) {
        await permission(actor, 'payments.merchants.secrets.manage', tx);
      }

      const current = id
        ? await tx.paymentMerchant.findUnique({where: {id}, include: {currentRevision: true}})
        : null;
      assertMerchantVersion(id, current, version, '商户配置已被其他管理员修改，请刷新后重试。');
      if (!current && name === LEGACY_ENV_MERCHANT_NAME) {
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
          ...secrets,
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
