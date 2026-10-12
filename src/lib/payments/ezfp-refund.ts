import { formatCnyCents, getEzfpCreateUrl, responseParams, signEzfpParams, verifyEzfpParams } from './ezfp-v2';

export class RefundProviderUncertain extends Error {}

async function request(path: 'refund' | 'query', fields: Record<string, string>) {
  const env = process.env;
  if (!env.EZFP_MERCHANT_PRIVATE_KEY || !env.EZFP_PLATFORM_PUBLIC_KEY || !env.EZFP_PID) throw new RefundProviderUncertain('provider_config_missing');
  const params = { ...fields, pid: env.EZFP_PID.trim(), timestamp: String(Math.floor(Date.now() / 1000)), sign_type: 'RSA' };
  const signed = { ...params, sign: signEzfpParams(params, env.EZFP_MERCHANT_PRIVATE_KEY) };
  let payload: Record<string, unknown>;
  try {
    const url = new URL(getEzfpCreateUrl(env)); url.pathname = `/api/pay/${path}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(signed), signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!response.ok) throw new Error('http_error');
    payload = await response.json();
  } catch { throw new RefundProviderUncertain('provider_connection_or_response'); }
  const flat = payload && responseParams(payload);
  if (!flat || !verifyEzfpParams(flat, env.EZFP_PLATFORM_PUBLIC_KEY) || !/^\d{10}$/.test(flat.timestamp ?? '') || Math.abs(Date.now() / 1000 - Number(flat.timestamp)) > 300) throw new RefundProviderUncertain('provider_signature_or_timestamp');
  if (typeof payload.code !== 'number' || !Number.isInteger(payload.code)) throw new RefundProviderUncertain('provider_invalid_code');
  return payload;
}

export async function requestEzfpRefund(tradeNo: string, refundNo: string, amountCnyCents: number) {
  const amount = formatCnyCents(amountCnyCents);
  const data = await request('refund', { trade_no: tradeNo, out_refund_no: refundNo, money: amount });
  if (data.code !== 0) return { success: false as const };
  if (data.trade_no !== tradeNo || data.out_refund_no !== refundNo || data.money !== amount || typeof data.refund_no !== 'string' || !data.refund_no) throw new RefundProviderUncertain('provider_refund_mismatch');
  return { success: true as const, providerRefundNo: data.refund_no };
}

export async function verifyEzfpFullRefund(tradeNo: string, orderNo: string, amountCnyCents: number) {
  const data = await request('query', { trade_no: tradeNo, out_trade_no: orderNo });
  if (data.code !== 0 || data.trade_no !== tradeNo || data.out_trade_no !== orderNo || String(data.pid) !== process.env.EZFP_PID?.trim() || data.money !== formatCnyCents(amountCnyCents)) throw new RefundProviderUncertain('provider_query_mismatch');
  if (data.status === 2) return true;
  if (data.status === 1) return false;
  throw new RefundProviderUncertain('provider_order_not_paid');
}
