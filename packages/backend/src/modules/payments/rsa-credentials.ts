import {createPrivateKey, createPublicKey, type KeyObject} from 'node:crypto';

export function parsePaymentRsaKey(value: string, kind: 'private' | 'public'): KeyObject {
  const label = kind === 'private' ? '商户私钥' : '平台公钥';
  const source = value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').trim();
  let key: KeyObject | undefined;
  try {
    if (source.startsWith('-----BEGIN ')) {
      const allowed = kind === 'private'
        ? /^-----BEGIN (?:RSA )?PRIVATE KEY-----/
        : /^-----BEGIN (?:RSA )?PUBLIC KEY-----/;
      if (!allowed.test(source)) throw new Error('Wrong key kind');
      key = kind === 'private' ? createPrivateKey(source) : createPublicKey(source);
    } else {
      const body = source.replace(/\s/g, '');
      if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error('Invalid Base64');
      const der = Buffer.from(body, 'base64');
      for (const type of kind === 'private' ? ['pkcs8', 'pkcs1'] as const : ['spki', 'pkcs1'] as const) {
        try {
          key = kind === 'private'
            ? createPrivateKey({key: der, format: 'der', type: type as 'pkcs8' | 'pkcs1'})
            : createPublicKey({key: der, format: 'der', type: type as 'spki' | 'pkcs1'});
          const encoded = key.export({format: 'der', type});
          if (!der.equals(encoded)) { key = undefined; continue; }
          break;
        } catch { /* Try the other supported RSA container. */ }
      }
    }
  } catch { /* Return a field-specific message without exposing key material. */ }
  if (!key) {
    throw new Error(`${label}格式无效，支持完整 PEM 或不带头尾的 Base64 RSA 密钥。${kind === 'private' ? '请填写生成密钥对时保存的商户私钥，不能填写商户公钥或 MD5 密钥。' : '请填写支付平台公钥，不能填写商户公钥或私钥。'}`);
  }
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error(`${label}必须为至少 2048 位 RSA 密钥。`);
  }
  return key;
}

export function normalizePaymentRsaCredentials(privateKey: string, publicKey: string) {
  return {
    merchantPrivateKey: parsePaymentRsaKey(privateKey, 'private').export({format: 'pem', type: 'pkcs8'}).toString().trim(),
    platformPublicKey: parsePaymentRsaKey(publicKey, 'public').export({format: 'pem', type: 'spki'}).toString().trim(),
  };
}
