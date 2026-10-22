import {db, pragmasReady} from '@/lib/db';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {PaymentMerchantError, permission, publicSelect} from './merchant-guards';
import {secretData, validateRsaCredentials} from './merchant-credentials';

/**
 * 后台商户配置的读取与自检。
 *
 * 读取只回公开字段 + 「密钥是否存在」两个布尔；自检只验证本地能解密、格式合法，
 * 不连接渠道、不创建真实支付。
 */

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
