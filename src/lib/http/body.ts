import {NextResponse} from 'next/server';
import {privateHeaders} from './errors';

/**
 * Result of reading a JSON body: either the parsed `input`, or a ready-to-return
 * `response` for an oversized or malformed payload. Routes already written against
 * this shape stay unchanged — only the duplicated implementations were removed.
 */
export type JsonBodyResult = {input?: unknown; response?: NextResponse};

export type JsonBodyOptions = {
  /** Upper bound for `content-length`. */
  maxBytes?: number;
  /** Chinese message returned with 413. */
  tooLarge?: string;
  /** Headers attached to both error responses. */
  headers?: Record<string, string>;
};

/**
 * Read a JSON request body behind a size guard.
 *
 * `content-length` is client-supplied, so this is a cheap early reject rather than a
 * hard promise: a request can lie about its length or omit it entirely. The real
 * protection is that `request.json()` is awaited once and its failure is mapped to
 * one Chinese message that reveals nothing about the payload.
 */
export async function readJsonBody(
  request: Request,
  options: JsonBodyOptions = {},
): Promise<JsonBodyResult> {
  const {maxBytes = 40_000, tooLarge = '请求数据过大。', headers = privateHeaders} = options;
  const size = Number(request.headers.get('content-length') || 0);
  if (size > maxBytes) return {response: NextResponse.json({error: tooLarge}, {status: 413, headers})};
  try {
    return {input: (await request.json()) as unknown};
  } catch {
    return {response: NextResponse.json({error: '请求数据格式不正确。'}, {status: 400, headers})};
  }
}
