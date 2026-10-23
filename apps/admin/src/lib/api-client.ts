export class AdminApiError extends Error { constructor(readonly status:number, message:string){super(message);this.name='AdminApiError';} }
export async function apiFetch<T>(path:string, options: {method?:string; body?:unknown; signal?:AbortSignal; credentials?:RequestCredentials; cache?:RequestCache} = {}): Promise<T> {
  const response = await fetch(path, {method: options.method ?? 'GET', credentials: options.credentials ?? 'same-origin', cache: options.cache ?? 'no-store', signal: options.signal, headers: options.body === undefined ? undefined : {'Content-Type':'application/json'}, body: options.body === undefined ? undefined : JSON.stringify(options.body)});
  const data = await response.json().catch(() => null) as {error?:string} | null;
  if (!response.ok) throw new AdminApiError(response.status, data?.error ?? `请求失败（${response.status}）。`);
  return data as T;
}
export async function apiRaw(path:string, options: Parameters<typeof fetch>[1] = {}) { return fetch(path, {...options, credentials: options.credentials ?? 'same-origin', cache: options.cache ?? 'no-store'}); }
