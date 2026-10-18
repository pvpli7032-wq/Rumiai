import {NextResponse} from 'next/server';
import {logRouteError} from '@/lib/logger';
import {STATUS_CODES} from './status-codes';

/**
 * Authenticated API responses must never be cached by a shared proxy.
 * Exported here so every administration route sends the same header.
 */
export const privateHeaders = {'Cache-Control': 'private, no-store'};

/** The one error body shape every migrated route returns. */
export type ApiErrorBody = {error: string; code: string};

/** A domain error carries its own HTTP status; anything else is a server fault. */
function errorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const status = (error as {status?: unknown}).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

/**
 * Domain errors may name a stable machine code (PaymentOrderError does). Keep it
 * only when it looks like a code; Prisma's P-codes never reach here because those
 * errors carry no status and fall through to the logged 500 branch.
 */
function errorCode(error: unknown, status: number): string {
  const code = (error as {code?: unknown}).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code) ? code : STATUS_CODES[status] ?? 'INTERNAL';
}

/** Uniform error body: `{error, code}` with a Chinese message. */
export function apiError(status: number, message: string, code?: string): NextResponse {
  return NextResponse.json({error: message, code: code ?? STATUS_CODES[status] ?? 'INTERNAL'}, {status, headers: privateHeaders});
}

export const unauthorized = () => apiError(401, '请先登录。');
export const forbidden = (message: string) => apiError(403, message);
export const badRequest = (message: string) => apiError(400, message);

/**
 * Map a thrown error to the uniform body. Domain errors keep their status,
 * message and code; unexpected failures are logged and reported with the route's
 * own Chinese fallback, so the caller learns nothing about internals.
 */
export function jsonError(error: unknown, routeName: string, fallback: string): NextResponse {
  const status = errorStatus(error);
  if (status !== null) return apiError(status, (error as Error).message || fallback, errorCode(error, status));
  logRouteError(routeName, error);
  return apiError(500, fallback);
}
