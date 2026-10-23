'use client';

import {useEffect, useState} from 'react';
import {apiFetch} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';

/**
 * 前台读取公开运营参数（/api/ui-config）。
 *
 * 为什么要有：字数上限、图片张数这类值现在由设置中心统一管理，前端不能各写一份常量，
 * 否则后台改完前端仍然按旧值拦截（V3 表 10「前后端共用同一值」）。
 *
 * 拿不到时返回空对象：调用方不要写死兜底值，服务端仍会按真实配置校验，
 * 前端只是少了一个输入提示，不会放行超长内容。
 */
let cache: Record<string, unknown> | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

function load(): Promise<Record<string, unknown>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = apiFetch<Record<string, unknown>>(API.uiConfig)
      .then(values => { cache = values; return values; })
      .catch(() => ({}))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useUiConfig(): Record<string, unknown> {
  const [values, setValues] = useState<Record<string, unknown>>(() => cache ?? {});
  useEffect(() => {
    let alive = true;
    void load().then(next => { if (alive) setValues(next); });
    return () => { alive = false; };
  }, []);
  return values;
}

/** 读取一个数字型参数；未加载或类型不对时返回 undefined，让调用方省略该约束。 */
export function readNumber(values: Record<string, unknown>, key: string): number | undefined {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
