import {normalizePaymentRsaCredentials} from './rsa-credentials';
import {decryptMerchantValue, encryptMerchantValue} from './merchant-secrets';
import {PaymentMerchantError} from './merchant-guards';

/**
 * 商户 RSA 凭据的加解密与格式校验。
 *
 * 明文只在内存里存在：进库一律走 encryptMerchantValue，出库一律走 decryptMerchantValue，
 * 版本记录里存的是六个密文字段而不是两段明文。
 */

/** 一条商户版本记录里的六个密文字段。 */
export type SecretParts = {
  privateKeyCiphertext: string;
  privateKeyNonce: string;
  privateKeyTag: string;
  platformKeyCiphertext: string;
  platformKeyNonce: string;
  platformKeyTag: string;
};

/** 解出一条版本记录里的两把密钥。 */
export function secretData(row: SecretParts) {
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

export function validateRsaCredentials(privateKey: string, platformKey: string) {
  try {
    return normalizePaymentRsaCredentials(privateKey, platformKey);
  } catch (error) {
    throw new PaymentMerchantError(error instanceof Error ? error.message : '支付密钥格式无效。');
  }
}

/**
 * 只加密不校验，产出可直接展开进 paymentMerchantRevision.create 的六个字段。
 *
 * 两处写版本都必须走这一处，否则字段映射迟早对不上。历史环境快照用它而不是
 * 下面那个校验版：旧环境里的密钥可能已不符合当前规范，但快照的目的是留档，
 * 不能因为格式校验把旧订单要用的凭据挡在门外。
 */
export function encryptSecretParts(privateKey: string, platformKey: string): SecretParts {
  const privateSecret = encryptMerchantValue(privateKey);
  const platformSecret = encryptMerchantValue(platformKey);
  return {
    privateKeyCiphertext: privateSecret.ciphertext,
    privateKeyNonce: privateSecret.nonce,
    privateKeyTag: privateSecret.tag,
    platformKeyCiphertext: platformSecret.ciphertext,
    platformKeyNonce: platformSecret.nonce,
    platformKeyTag: platformSecret.tag,
  };
}

/** 新建/更新版本用：先过 RSA 规范校验，再加密。 */
export function encryptRevisionSecrets(privateKey: string, platformKey: string): SecretParts {
  const normalized = validateRsaCredentials(privateKey, platformKey);
  return encryptSecretParts(normalized.merchantPrivateKey, normalized.platformPublicKey);
}
