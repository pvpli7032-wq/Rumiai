import type {ApiErrorBody} from './api-types/common';
import {statusCode} from './http/status-codes';

/**
 * 前端唯一的 HTTP 入口。这里只做四件事：拼认证头、序列化 body、把非 2xx
 * 统一抛成 `ApiError`、按需解析响应。业务判断留在调用方。
 *
 * 服务端只认 `Authorization: Bearer`，全仓库没有 cookie 鉴权，所以这里不发
 * `credentials: 'include'`。
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** 登录态由 `useAuth()` 提供；匿名请求留空。 */
  token?: string | null;
  /** 普通对象自动 JSON 序列化；FormData/Blob/string 原样发送。 */
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  cache?: RequestCache;
};

/** 请求失败时的文案：优先用服务端返回的中文，其次给一个带状态码的兜底。 */
function failureMessage(data: ApiErrorBody | null, status: number): string {
  return data?.error ?? `请求失败（${status}）。`;
}

async function request(path: string, options: ApiRequest): Promise<Response> {
  const {token, body, headers, ...init} = options;
  const raw = body instanceof FormData || body instanceof Blob || typeof body === 'string';
  const payload = body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      body: payload,
      headers: {
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        ...(body !== undefined && !raw ? {'Content-Type': 'application/json'} : {}),
        ...headers,
      },
    });
  } catch (error) {
    // 取消是正常控制流（组件卸载、切会话），必须原样抛出让调用方识别。
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请重试。');
  }

  if (!response.ok) {
    // 404 之类可能回 HTML，解析失败不能盖住真实状态码。
    const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, data?.code ?? statusCode(response.status), failureMessage(data, response.status), data);
  }

  return response;
}

/** 解析 JSON；204 没有 body，返回 undefined。 */
export async function apiFetch<T>(path: string, options: ApiRequest = {}): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** 导出类接口：调用方拿到 Blob 自己造下载链接。 */
export async function apiBlob(path: string, options: ApiRequest = {}): Promise<Blob> {
  return (await request(path, options)).blob();
}

/** SSE 与需要读响应头的场景（如商城 `X-Checkout-Enabled`）。 */
export async function apiRaw(path: string, options: ApiRequest = {}): Promise<Response> {
  return request(path, options);
}

export const api = {
  get: <T>(path: string, options?: Omit<ApiRequest, 'method' | 'body'>) => apiFetch<T>(path, {...options, method: 'GET'}),
  post: <T>(path: string, body?: unknown, options?: Omit<ApiRequest, 'method' | 'body'>) => apiFetch<T>(path, {...options, method: 'POST', body}),
  put: <T>(path: string, body?: unknown, options?: Omit<ApiRequest, 'method' | 'body'>) => apiFetch<T>(path, {...options, method: 'PUT', body}),
  patch: <T>(path: string, body?: unknown, options?: Omit<ApiRequest, 'method' | 'body'>) => apiFetch<T>(path, {...options, method: 'PATCH', body}),
  del: <T>(path: string, options?: Omit<ApiRequest, 'method' | 'body'>) => apiFetch<T>(path, {...options, method: 'DELETE'}),
  blob: apiBlob,
  raw: apiRaw,
};
