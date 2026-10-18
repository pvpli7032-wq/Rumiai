import { constants, createSign, createVerify } from 'node:crypto';
import {parsePaymentRsaKey} from './rsa-credentials';

export type EzfpParams = Record<string, string>;

/** V2 protocol signing: UTF-8 key/value pairs sorted by key, excluding sign metadata and empty values. */
export function canonicalizeEzfpParams(params: EzfpParams): string {
  return Object.keys(params)
    .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== '')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

export function signEzfpParams(params: EzfpParams, privateKey: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalizeEzfpParams(params), 'utf8');
  signer.end();
  return signer.sign({ key: parsePaymentRsaKey(privateKey, 'private'), padding: constants.RSA_PKCS1_PADDING }, 'base64');
}

export function verifyEzfpParams(params: EzfpParams, publicKey: string): boolean {
  if (!params.sign || (params.sign_type && params.sign_type !== 'RSA')) return false;
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(canonicalizeEzfpParams(params), 'utf8');
    verifier.end();
    return verifier.verify(
      { key: parsePaymentRsaKey(publicKey, 'public'), padding: constants.RSA_PKCS1_PADDING },
      params.sign.replace(/ /g, '+'),
      'base64'
    );
  } catch {
    return false;
  }
}

export function formatCnyCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('Invalid CNY cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Parse the original provider amount only after signature verification. No floating-point rounding. */
export function parseCnyCents(value: string): number | null {
  if (typeof value !== 'string' || value.length > 20) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? '').padEnd(2, '0'));
  return cents > BigInt(0) && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** Test endpoint override is restricted to local development servers. */
export function getEzfpCreateUrl(env: Record<string, string | undefined>): string {
  const override = env.EZFP_API_BASE_URL?.trim();
  if (override && env.NODE_ENV !== 'production') {
    const url = new URL(override);
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('EZFP_API_BASE_URL may only point to localhost outside production');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('EZFP_API_BASE_URL must use HTTP or HTTPS');
    }
    return `${url.origin}/api/pay/create`;
  }
  return 'https://www.ezfp.cn/api/pay/create';
}

export function getPublicSiteOrigin(env: Record<string, string | undefined>): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) throw new Error('NEXT_PUBLIC_SITE_URL is required for payment callbacks');
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid NEXT_PUBLIC_SITE_URL');
  if (env.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) {
    throw new Error('Production payment callback URL must be public HTTPS');
  }
  if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
    throw new Error('Payment callback URL must use HTTPS');
  }
  return url.origin;
}

export function isEzfpConfigured(env: Record<string, string | undefined>): boolean {
  if (
    env.EZFP_ENABLED !== 'true' ||
    !/^\d+$/.test(env.EZFP_PID?.trim() || '') ||
    !env.EZFP_MERCHANT_PRIVATE_KEY?.trim() ||
    !env.EZFP_PLATFORM_PUBLIC_KEY?.trim()
  ) return false;
  try {
    getEzfpCreateUrl(env);
    getPublicSiteOrigin(env);
    return true;
  } catch {
    return false;
  }
}

export function isSafePaymentRedirect(value: string, env: Record<string, string | undefined>): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (env.NODE_ENV === 'production') return url.protocol === 'https:';
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}

export function uniqueUrlParams(url: URL): EzfpParams | null {
  const params: EzfpParams = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(params, key)) return null;
    params[key] = value;
  }
  return params;
}

export function responseParams(value: Record<string, unknown>): EzfpParams | null {
  const params: EzfpParams = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) params[key] = '';
    else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') params[key] = String(item);
    else return null;
  }
  return params;
}

export class EzfpProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'EzfpProviderError'; }
}

export async function createEzfpCheckout(params: EzfpParams, env: Record<string, string | undefined>) {
  const privateKey = env.EZFP_MERCHANT_PRIVATE_KEY;
  const publicKey = env.EZFP_PLATFORM_PUBLIC_KEY;
  if (!privateKey || !publicKey) throw new EzfpProviderError('EZFP 服务端密钥未配置。');

  const signed: EzfpParams = { ...params, sign_type: 'RSA' };
  signed.sign = signEzfpParams(signed, privateKey);
  let response: Response;
  try {
    response = await fetch(getEzfpCreateUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(signed),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new EzfpProviderError('支付服务连接失败，订单状态待核对。');
  }
  if (!response.ok) throw new EzfpProviderError('支付服务暂时不可用，订单状态待核对。');

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  // The platform may return an unsigned {code,msg} rejection. It cannot prove
  // payment status, but reporting it does not authorize a redirect or credit.
  if (payload && !payload.sign && /^-?\d+$/.test(String(payload.code)) && Number(payload.code) !== 0) {
    const message = typeof payload.msg === 'string' ? payload.msg.slice(0, 160) : '请检查商户配置和支付方式。';
    throw new EzfpProviderError(`支付平台未受理请求：${message}。订单状态仍需核对。`);
  }
  const signedResponse = payload && responseParams(payload);
  if (!payload || !signedResponse || !verifyEzfpParams(signedResponse, publicKey)) {
    throw new EzfpProviderError('支付服务响应验签失败，订单状态待核对。');
  }
  if (String(payload.code) !== '0') {
    throw new EzfpProviderError(typeof payload.msg === 'string' ? payload.msg.slice(0, 160) : '支付服务未能创建订单。');
  }
  if (typeof payload.trade_no !== 'string' || !payload.trade_no || payload.pay_type !== 'jump' || typeof payload.pay_info !== 'string' || !isSafePaymentRedirect(payload.pay_info, env)) {
    throw new EzfpProviderError('支付服务返回的订单信息无效。');
  }
  return { tradeNo: payload.trade_no, payType: payload.pay_type, payInfo: payload.pay_info };
}
